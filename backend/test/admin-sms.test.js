const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-only-jwt-secret-with-more-than-32-characters';

const dbPath = require.resolve('../src/config/db');
let query;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: (...args) => query(...args),
} };
const app = require('../src/app');

let server;
let base;
const token = jwt.sign({ id: 1, username: 'admin' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const auth = { Authorization: `Bearer ${token}` };

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}/api/admin`;
});
after(() => server && new Promise(resolve => server.close(resolve)));

test('관리자 API는 토큰 없이 접근할 수 없고 DB도 조회하지 않는다', async () => {
  query = () => assert.fail('unexpected DB query');
  for (const [method, path] of [['GET', '/cameras'], ['PATCH', '/cameras/1/alert-phone'], ['GET', '/sms-logs']]) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'PATCH' ? '{}' : undefined });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test('GET /admin/cameras는 알림 번호를 포함해 반환한다', async () => {
  query = async (sql, params) => {
    assert.match(sql, /alert_phone/);
    assert.deepEqual(params, [50, 0]);
    return { rows: [{ id: 1, name: 'demo', source_type: 'test', alert_phone: '01012345678' }] };
  };
  const response = await fetch(`${base}/cameras`, { headers: auth });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    items: [{ id: 1, name: 'demo', source_type: 'test', alert_phone: '01012345678' }],
    limit: 50,
    offset: 0,
  });
});

test('PATCH /admin/cameras/:id/alert-phone은 번호를 저장하고 null로 해제한다', async () => {
  const calls = [];
  query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 2, name: 'cam', alert_phone: params[1] }] };
  };
  for (const alertPhone of ['01012345678', null]) {
    const response = await fetch(`${base}/cameras/2/alert-phone`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_phone: alertPhone }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: 2, name: 'cam', alert_phone: alertPhone });
  }
  assert.match(calls[0].sql, /UPDATE cameras SET alert_phone = \$2 WHERE id = \$1/);
  assert.deepEqual(calls.map(call => call.params), [[2, '01012345678'], [2, null]]);
});

test('잘못된 번호와 요청은 DB 접근 전에 400으로 거부한다', async () => {
  query = () => assert.fail('unexpected DB query');
  const bodies = [{}, { alert_phone: 'abc' }, { alert_phone: '010-1234-5678' }, { alert_phone: '0212345678' },
    { alert_phone: '0101234567' }, { alert_phone: 1012345678 }, { alert_phone: '' }];
  for (const body of bodies) {
    const response = await fetch(`${base}/cameras/2/alert-phone`, {
      method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  for (const id of ['0', 'abc', '2147483648']) {
    const response = await fetch(`${base}/cameras/${id}/alert-phone`, {
      method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ alert_phone: null }),
    });
    assert.equal(response.status, 400, id);
  }
});

test('없는 카메라의 번호 저장은 404를 반환한다', async () => {
  query = async () => ({ rows: [] });
  const response = await fetch(`${base}/cameras/9/alert-phone`, {
    method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ alert_phone: '01012345678' }),
  });
  assert.equal(response.status, 404);
});

test('GET /admin/sms-logs는 최신순 발송 내역을 반환한다', async () => {
  query = async (sql, params) => {
    assert.match(sql, /FROM sms_logs/);
    assert.match(sql, /ORDER BY l\.created_at DESC, l\.id DESC/);
    assert.deepEqual(params, [20, 5]);
    return { rows: [{
      id: 4, camera_id: 1, camera_name: 'demo', event_id: 9, phone_number: '01012345678',
      message: '화재', status: 'sent', provider: 'solapi', error: null, created_at: new Date('2026-11-03T01:00:00Z'),
    }] };
  };
  const response = await fetch(`${base}/sms-logs?limit=20&offset=5`, { headers: auth });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items[0].created_at, '2026-11-03T01:00:00.000Z');
  assert.equal(body.items[0].status, 'sent');
  assert.deepEqual([body.limit, body.offset], [20, 5]);
});

test('발송 내역의 잘못된 페이지 값은 400이다', async () => {
  query = () => assert.fail('unexpected DB query');
  const response = await fetch(`${base}/sms-logs?limit=0`, { headers: auth });
  assert.equal(response.status, 400);
});
