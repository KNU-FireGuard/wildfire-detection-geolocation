const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
process.env.AI_CALLBACK_TOKEN = 'capture-test-token-with-at-least-32-bytes';
const rows = [];
let last = null;
const client = {
  async query(sql, params) {
    if (/FOR UPDATE/.test(sql)) return { rows: [{ id: params[0] }] };
    if (/SELECT video_time_ms/.test(sql)) return { rows: last === null ? [] : [{ video_time_ms: last }] };
    if (/INSERT INTO event_captures/.test(sql)) {
      last = params[1]; const row = { id: rows.length + 1, event_id: params[0], video_time_ms: last, jpeg: params[2] };
      rows.push(row); return { rows: [row] };
    }
    return { rows: [] };
  }, release() {},
};
const dbPath = require.resolve('../src/config/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  connect: async () => client,
  query: async (sql, params = []) => ({ rows: /SELECT jpeg/.test(sql) ? rows.slice(0, 1)
    : rows.filter(row => params[3] === undefined || row.video_time_ms < params[3]).slice().reverse() }),
} };
const runs = require('../src/services/run-manager');
const run = runs.createRun({ cameraId: 3, videoId: 7 });
run.status = 'running';
const app = require('../src/app');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
let server, base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); runs.removeRun(run); });
const upload = (time, body = jpeg, token = process.env.AI_CALLBACK_TOKEN, name = 'smoke') => fetch(`${base}/test-runs/${run.id}/captures/${name}`, {
  method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-AI-Token': token, 'X-Video-Time-Ms': String(time) }, body,
});

test('캡처 업로드는 AI 인증과 확정된 테스트 이벤트가 필요하다', async () => {
  assert.equal((await upload(0, jpeg, 'invalid')).status, 401);
  assert.equal((await upload(0)).status, 409);
  run.eventIdsByClass.set('smoke', 9);
  assert.equal((await upload(0, Buffer.from('bad'))).status, 400);
  assert.equal((await upload(-1)).status, 400);
  assert.equal((await upload(0, jpeg, process.env.AI_CALLBACK_TOKEN, 'other')).status, 400);
  assert.equal(rows.length, 0);
});

test('최초·5초 경계 저장, 중복 억제, 목록과 JPEG 조회 및 종료 후 업로드 거부', async () => {
  assert.equal((await upload(3800)).status, 201);
  assert.equal((await upload(8799)).status, 200);
  assert.equal((await upload(8800)).status, 201);
  assert.equal(rows.length, 2);
  const response = await fetch(`${base}/events/9/captures?limit=20&offset=0`);
  const data = await response.json();
  assert.equal(data.items.length, 2);
  assert.equal(data.items[0].image_url, '/api/event-captures/2/image');
  const older = await (await fetch(`${base}/events/9/captures?limit=20&before_time_ms=8800`)).json();
  assert.deepEqual(older.items.map(item => item.video_time_ms), [3800]);
  assert.equal((await fetch(`${base}/events/9/captures?before_time_ms=invalid`)).status, 400);
  const image = await fetch(`${base}/event-captures/1/image`);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), jpeg);
  run.status = 'completed';
  assert.equal((await upload(13800)).status, 409);
  assert.equal((await fetch(`${base}/event-captures/invalid/image`)).status, 400);
});

test('2MB 초과 업로드는 거부한다', async () => {
  assert.equal((await upload(0, Buffer.alloc(2097153))).status, 413);
});
