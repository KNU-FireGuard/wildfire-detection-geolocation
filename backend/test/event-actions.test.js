const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
let exists = true;
const statements = [];
const client = { async query(sql, params) {
  statements.push(sql);
  if (/FOR UPDATE/.test(sql)) return { rows: exists ? [{ id: params[0] }] : [] };
  if (/DELETE FROM detection_events/.test(sql)) return { rows: [{ id: params[0] }] };
  return { rows: [] };
}, release() {} };
const dbPath = require.resolve('../src/config/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async sql => { statements.push(sql); return { rows: [{ id: 1 }, { id: 2 }] }; },
  connect: async () => client,
} };
const app = require('../src/app');
const runs = require('../src/services/run-manager');
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/api`; });
after(async () => { await new Promise(resolve => server.close(resolve)); });

test('전체 확인은 필터와 무관하게 미확인 이벤트만 한 SQL로 확인하고 ID를 반환한다', async () => {
  statements.length = 0;
  const response = await fetch(`${base}/events/acknowledge-all`, { method: 'POST' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ids: [1, 2], count: 2 });
  assert.equal(statements.length, 1);
  assert.match(statements[0], /WHERE acknowledged_at IS NULL/);
  assert.doesNotMatch(statements[0], /updated_at\s*=/);
});

test('이벤트 삭제는 문자 이력을 보존하고 트랜잭션으로 이벤트를 제거한다', async () => {
  statements.length = 0;
  const response = await fetch(`${base}/events/7`, { method: 'DELETE' });
  assert.equal(response.status, 204);
  assert.ok(statements.some(sql => /UPDATE sms_logs SET event_id = NULL/.test(sql)));
  assert.ok(statements.some(sql => /DELETE FROM detection_events/.test(sql)));
  assert.equal(statements.at(-1), 'COMMIT');
});

test('분석 중인 이벤트는 삭제를 막고 없는 이벤트·잘못된 ID를 처리한다', async () => {
  const run = runs.createRun({ cameraId: 1, videoId: 1 });
  run.status = 'running'; run.eventIdsByClass.set('smoke', 8);
  try { assert.equal((await fetch(`${base}/events/8`, { method: 'DELETE' })).status, 409); }
  finally { runs.removeRun(run); }
  exists = false;
  assert.equal((await fetch(`${base}/events/9`, { method: 'DELETE' })).status, 404);
  assert.equal((await fetch(`${base}/events/invalid`, { method: 'DELETE' })).status, 400);
});
