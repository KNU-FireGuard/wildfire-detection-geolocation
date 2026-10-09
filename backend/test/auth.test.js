const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, scryptSync } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../src/middleware/require-admin');

process.env.JWT_SECRET = 'test-only-jwt-secret-with-more-than-32-characters';

const dbPath = require.resolve('../src/config/db');
let query;
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { query: (...args) => query(...args) },
};

const app = require('../src/app');
let server;
let base;

function passwordHash(password) {
  const cost = 1024;
  const blockSize = 8;
  const parallelism = 1;
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${cost}$${blockSize}$${parallelism}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const admin = {
  id: 7,
  username: 'admin',
  password_hash: passwordHash('correct-password'),
};

test('JWT_SECRET이 없거나 짧거나 공개 placeholder면 거부한다', () => {
  const original = process.env.JWT_SECRET;
  try {
    for (const secret of ['', 'too-short', 'replace_with_random_secret_at_least_32_characters']) {
      process.env.JWT_SECRET = secret;
      assert.throws(() => getJwtSecret(), /JWT_SECRET/);
    }
  } finally {
    process.env.JWT_SECRET = original;
  }
  assert.equal(getJwtSecret(), original);
});

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server && new Promise(resolve => server.close(resolve)));

test('관리자 로그인 성공 시 1시간 유효한 Bearer JWT를 발급한다', async () => {
  query = async (sql, params) => {
    assert.match(sql, /SELECT id, username, password_hash FROM admins/);
    assert.deepEqual(params, ['admin']);
    return { rows: [admin] };
  };

  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'correct-password' }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.expires_in, 3600);
  assert.ok(body.access_token);
  const claims = jwt.verify(body.access_token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  assert.equal(claims.id, admin.id);
  assert.equal(claims.username, admin.username);
  assert.equal(claims.exp - claims.iat, 3600);
});

test('없는 계정과 잘못된 비밀번호는 같은 401 응답을 반환한다', async () => {
  query = async () => ({ rows: [admin] });
  const wrongPassword = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
  });
  assert.equal(wrongPassword.status, 401);

  query = async () => ({ rows: [] });
  const unknownAdmin = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'unknown', password: 'wrong-password' }),
  });
  assert.equal(unknownAdmin.status, 401);
  assert.deepEqual(await unknownAdmin.json(), await wrongPassword.json());
});

test('로그인 요청에 ID 또는 비밀번호가 없으면 400을 반환한다', async () => {
  query = () => assert.fail('입력 검증 전에 DB를 조회하면 안 됩니다');
  const response = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin' }),
  });
  assert.equal(response.status, 400);
});

test('유효한 JWT로 로그인 관리자 정보를 조회한다', async () => {
  query = async () => ({ rows: [admin] });
  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'correct-password' }),
  });
  const { access_token: token } = await login.json();

  const response = await fetch(`${base}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: admin.id, username: admin.username });
});

test('누락·잘못된 형식·만료된 JWT는 401을 반환한다', async () => {
  const expiredToken = jwt.sign(
    { id: admin.id, username: admin.username },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: -1 },
  );

  for (const authorization of [undefined, 'Basic abc', 'Bearer invalid.token', `Bearer ${expiredToken}`]) {
    const response = await fetch(`${base}/auth/me`, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    assert.equal(response.status, 401);
  }
});
