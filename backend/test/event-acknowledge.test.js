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

test('이벤트 확인은 관리자 토큰 없이 할 수 없고 DB도 변경하지 않는다', async () => {
  query = () => assert.fail('unexpected DB query');
  const response = await fetch(`${base}/admin/events/1/acknowledge`, { method: 'POST' });
  assert.equal(response.status, 401);
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
  assert.doesNotMatch(calls[0].sql, /updated_at/);
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
