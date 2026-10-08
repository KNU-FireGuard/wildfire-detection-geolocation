const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const dbPath = require.resolve('../src/config/db');
let query;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: (...args) => query(...args),
} };
const app = require('../src/app');
let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && new Promise(resolve => server.close(resolve)));

for (const resource of ['cameras', 'videos', 'events']) {
  test(`${resource}: empty list and pagination`, async () => {
    query = async (sql, params) => {
      assert.deepEqual(params, [20, 5]);
      return { rows: [] };
    };
    const response = await fetch(`${base}/api/${resource}?limit=20&offset=5`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [], limit: 20, offset: 5 });
  });
}
test('list serializes nullable fields and UTC dates', async () => {
  query = async (sql, params) => {
    assert.deepEqual(params, [50, 0]);
    return { rows: [{ id: 1, latitude: null, longitude: null, created_at: new Date('2026-10-01T09:00:00Z') }] };
  };
  const response = await fetch(`${base}/api/cameras`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [{ id: 1, latitude: null, longitude: null, created_at: '2026-10-01T09:00:00.000Z' }], limit: 50, offset: 0 });
});
test('invalid pagination rejected before database access', async () => {
  query = () => assert.fail('unexpected DB query');
  for (const params of ['limit=0', 'limit=101', 'offset=-1', 'offset=2147483648', 'limit=1.5', 'limit=1&limit=2', 'limit=', 'offset=abc']) {
    const response = await fetch(`${base}/api/events?${params}`);
    assert.equal(response.status, 400, params);
  }
});
test('invalid event IDs rejected before database access', async () => {
  query = () => assert.fail('unexpected DB query');
  for (const id of ['0', '-1', '1.5', '2147483648', 'abc', '1%20OR%201=1']) {
    const response = await fetch(`${base}/api/events/${id}`);
    assert.equal(response.status, 400, id);
  }
});
test('missing event returns 404', async () => {
  query = async (sql, params) => {
    assert.deepEqual(params, [123]);
    return { rows: [] };
  };
  const response = await fetch(`${base}/api/events/123`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: '탐지 이벤트가 없습니다.' });
});
test('event detail returns one item', async () => {
  const event = { id: 2, video_id: 3, camera_id: null, ended_at: null };
  query = async (sql, params) => {
    assert.deepEqual(params, [2]);
    return { rows: [event] };
  };
  const response = await fetch(`${base}/api/events/2`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { item: event });
});
test('database failure returns 500 without exposing database details', async () => {
  query = async () => { throw new Error('database failure'); };
  const response = await fetch(`${base}/api/videos`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: '서버 내부 오류가 발생했습니다.' });
});
