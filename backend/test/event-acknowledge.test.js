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
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server && new Promise(resolve => server.close(resolve)));

test('이벤트 확인은 로그인 없이 공개 API와 기존 주소에서 모두 처리한다', async () => {
  query = async sql => /^\s*UPDATE/i.test(sql)
    ? { rows: [] } : { rows: [{ id: 5, class: 'fire', acknowledged_at: '2026-11-04T01:00:00.000Z' }] };
  for (const url of ['/events/5/acknowledge', '/admin/events/5/acknowledge']) {
    const response = await fetch(base + url, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).item.id, 5);
  }
});

test('SMS 설정과 발송 내역은 로그인 없이 조회하거나 변경할 수 없다', async () => {
  query = () => assert.fail('unexpected DB query');
  for (const [url, method] of [['/admin/cameras', 'GET'], ['/admin/sms-logs', 'GET'], ['/admin/cameras/1/alert-phone', 'PATCH']]) {
    assert.equal((await fetch(base + url, { method })).status, 401);
  }
});

test('SMS 관리자 토큰이 만료되어도 공개 이벤트 확인은 독립적으로 처리한다', async () => {
  query = async sql => /^\s*UPDATE/i.test(sql) ? { rows: [] } : { rows: [{ id: 5, acknowledged_at: '2026-11-04T01:00:00Z' }] };
  const response = await fetch(`${base}/events/5/acknowledge`, { method: 'POST', headers: { Authorization: 'Bearer expired-or-invalid' } });
  assert.equal(response.status, 200);
});

test('확인 저장에 실패하면 성공으로 응답하지 않고 서버 오류를 전달한다', async () => {
  query = async () => { throw new Error('simulated database failure'); };
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await fetch(`${base}/events/5/acknowledge`, { method: 'POST' })).status, 500);
  } finally { console.error = original; }
});

test('이벤트 ID가 정수가 아니면 400을 돌려주고 DB를 조회하지 않는다', async () => {
  query = () => assert.fail('unexpected DB query');
  for (const id of ['abc', '0', '1.5', '99999999999']) {
    const response = await fetch(`${base}/admin/events/${id}/acknowledge`, { method: 'POST', headers: auth });
    assert.equal(response.status, 400, id);
  }
});

test('없는 이벤트는 404를 돌려준다', async () => {
  query = async () => ({ rows: [] });
  const response = await fetch(`${base}/admin/events/5/acknowledge`, { method: 'POST', headers: auth });
  assert.equal(response.status, 404);
});

test('처음 확인하면 확인 시각을 저장하고 이벤트를 돌려준다', async () => {
  const calls = [];
  query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^\s*UPDATE/i.test(sql)) return { rows: [{ id: 5 }] };
    return { rows: [{ id: 5, class: 'fire', acknowledged_at: new Date('2026-11-04T01:00:00Z') }] };
  };
  const response = await fetch(`${base}/admin/events/5/acknowledge`, { method: 'POST', headers: auth });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { item: { id: 5, class: 'fire', acknowledged_at: '2026-11-04T01:00:00.000Z' } });
  assert.match(calls[0].sql, /acknowledged_at IS NULL/)
  // updated_at은 마지막 탐지 시각 판단에 쓰므로 확인할 때 바꾸지 않음
  assert.doesNotMatch(calls[0].sql, /updated_at\s*=/);
  assert.deepEqual(calls[0].params, [5]);
});

test('이미 확인한 이벤트를 다시 확인해도 확인 시각을 바꾸지 않고 200을 돌려준다', async () => {
  query = async sql => {
    if (/^\s*UPDATE/i.test(sql)) return { rows: [] };
    return { rows: [{ id: 5, acknowledged_at: new Date('2026-11-04T01:00:00Z') }] };
  };
  const response = await fetch(`${base}/admin/events/5/acknowledge`, { method: 'POST', headers: auth });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).item.acknowledged_at, '2026-11-04T01:00:00.000Z');
});

test('이벤트 조회 응답에는 확인 시각이 포함된다', async () => {
  query = async sql => {
    assert.match(sql, /e\.acknowledged_at/);
    assert.match(sql, /AS is_alerting/);
    assert.match(sql, /INTERVAL '30 minutes'/);
    return { rows: [] };
  };
  assert.equal((await fetch(`${base}/events`)).status, 200);
  assert.equal((await fetch(`${base}/events/1`)).status, 404);
});

test('화재 이벤트를 확인하면 같은 카메라에서 알림 중인 다른 화재 이벤트도 함께 확인 처리한다', async () => {
  const calls = [];
  query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^\s*UPDATE/i.test(sql)) return { rows: [] };
    return { rows: [{ id: 5, class: 'fire' }] };
  };
  await fetch(`${base}/admin/events/5/acknowledge`, { method: 'POST', headers: auth });
  const update = calls[0].sql;
  assert.deepEqual(calls[0].params, [5]);
  // 대상 이벤트 자신, 또는 대상이 fire일 때 같은 카메라의 알림 중(확인 전, 마지막 탐지 30분 안) fire 이벤트
  assert.match(update, /id = \$1/);
  assert.match(update, /INTERVAL '30 minutes'/);
  assert.match(update, /class = 'fire'/);
  assert.match(update, /videos/);
});
