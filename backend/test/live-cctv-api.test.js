const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ITS_CCTV_API_KEY = '';
process.env.JWT_SECRET = 'test-only-jwt-secret-with-more-than-32-characters';
process.env.AI_CALLBACK_TOKEN = 'test-only-ai-callback-token-with-32-bytes';
const app = require('../src/app');
let server;
let base;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}/api/live-cctvs`;
});

test('감시 상태 조회와 AI 프레임 heartbeat는 인증·실행 ID를 검증한다', async () => {
  const status = await fetch(base.replace('/live-cctvs', '/live-monitor/status'));
  assert.equal(status.status, 200);
  assert.equal(typeof (await status.json()).state, 'string');

  const url = base.replace('/live-cctvs', '/live-monitor/heartbeat');
  const denied = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401);
  const headers = { 'Content-Type': 'application/json', 'X-AI-Token': process.env.AI_CALLBACK_TOKEN };
  const invalid = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ run_id: 0, camera_id: 1 }) });
  assert.equal(invalid.status, 400);
  const missing = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ run_id: 123, camera_id: 1 }) });
  assert.equal(missing.status, 404);
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); });

test('지도 목록 조회는 저장된 실제 데이터만 반환하고 갱신은 관리자 인증을 요구한다', async () => {
  const list = await fetch(base);
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.equal(body.source, 'live');
  assert.ok(body.items.length <= 6);
  assert.ok(body.items.every(item => item.streamUrl?.startsWith('https://')));

  const anonymous = await fetch(`${base}/refresh`, { method: 'POST' });
  assert.equal(anonymous.status, 401);
  const unavailable = await fetch(`${base}/${'a'.repeat(32)}/runs`, { method: 'POST' });
  assert.equal(unavailable.status, 404);
});
