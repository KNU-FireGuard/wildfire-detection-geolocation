const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { PassThrough, Readable } = require('node:stream');
const fs = require('node:fs/promises');
const path = require('node:path');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-only-jwt-secret-with-more-than-32-characters';
process.env.AI_CALLBACK_TOKEN = 'test-only-ai-callback-token-with-32-bytes';
process.env.PORT = '3000';
delete process.env.AI_MODEL_PATH;

const fixtureFilename = `test-run-${randomUUID()}.mp4`;
const fixturePath = path.resolve(__dirname, '../../data/videos', fixtureFilename);
const queryCalls = [];
const poolPath = require.resolve('../src/config/db');
require.cache[poolPath] = {
  id: poolPath,
  filename: poolPath,
  loaded: true,
  exports: {
    async query(sql, params = []) {
      queryCalls.push({ sql, params });
      if (/SELECT c\.id AS camera_id, c\.source_type/.test(sql)) {
        return { rows: [{ camera_id: 1, source_type: 'test', video_id: 7, file_path: `data/videos/${fixtureFilename}` }] };
      }
      if (/INSERT INTO detection_events/.test(sql)) return { rows: [{ id: 91 }] };
      if (/UPDATE detection_events/.test(sql)) return { rows: [{ id: params[0] }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  },
};

const spawned = [];
const childProcess = require('node:child_process');
const originalSpawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  spawned.push({ command, args, options, child });
  setImmediate(() => child.emit('spawn'));
  return child;
};

const app = require('../src/app');
childProcess.spawn = originalSpawn;

let server;
let base;
const adminToken = jwt.sign({ id: 1, username: 'admin' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
const adminHeaders = { Authorization: `Bearer ${adminToken}` };
const aiHeaders = { 'X-AI-Token': process.env.AI_CALLBACK_TOKEN };

before(async () => {
  await fs.mkdir(path.dirname(fixturePath), { recursive: true });
  await fs.writeFile(fixturePath, Buffer.from('video-fixture'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.rm(fixturePath, { force: true });
});

test('Test API는 관리자 인증, MJPEG 중계, AI 탐지 콜백을 연결한다', async () => {
  const unauthorized = await fetch(`${base}/cameras/1/test-runs`, { method: 'POST' });
  assert.equal(unauthorized.status, 401);

  const started = await fetch(`${base}/cameras/1/test-runs`, {
    method: 'POST',
    headers: adminHeaders,
  });
  assert.equal(started.status, 202);
  const run = await started.json();
  assert.deepEqual(run, {
    id: run.id,
    camera_id: 1,
    video_id: 7,
    status: 'ready',
    stream_url: `/api/test-runs/${run.id}/stream`,
    status_url: `/api/test-runs/${run.id}`,
  });
  assert.equal(Number.isSafeInteger(run.id), true);

  const duplicate = await fetch(`${base}/cameras/1/test-runs`, {
    method: 'POST',
    headers: adminHeaders,
  });
  assert.equal(duplicate.status, 409);

  await new Promise(resolve => setImmediate(resolve));
  const child = spawned.at(-1);
  assert.ok(child);
  assert.ok(child.args.includes('--run-id'));
  assert.ok(child.args.includes(String(run.id)));
  assert.ok(child.args.includes('--camera-id'));
  assert.ok(child.args.includes('http://127.0.0.1:3000/api/detections'));
  assert.ok(child.args.includes(`http://127.0.0.1:3000/api/test-runs/${run.id}/video`));
  assert.ok(child.args.includes(path.resolve(__dirname, '../../data/videos', fixtureFilename)));

  const status = await fetch(`${base}/test-runs/${run.id}`, { headers: adminHeaders });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).status, 'running');

  const deniedStream = await fetch(`${base}/test-runs/${run.id}/stream`);
  assert.equal(deniedStream.status, 401);

  const detection = await fetch(`${base}/detections`, {
    method: 'POST',
    headers: { ...aiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      run_id: run.id,
      camera_id: 1,
      detection: { class: 'fire', confidence: 0.94, bbox: { x1: 1, y1: 2, x2: 3, y2: 4 } },
      location_estimation: null,
    }),
  });
  assert.equal(detection.status, 202);
  assert.deepEqual(await detection.json(), { accepted: true });
  assert.ok(queryCalls.some(call => /INSERT INTO detection_events/.test(call.sql)));

  const repeatedDetection = await fetch(`${base}/detections`, {
    method: 'POST',
    headers: { ...aiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      run_id: run.id,
      camera_id: 1,
      detection: { class: 'fire', confidence: 0.98, bbox: { x1: 2, y1: 3, x2: 4, y2: 5 } },
      location_estimation: null,
    }),
  });
  assert.equal(repeatedDetection.status, 202);
  assert.ok(queryCalls.some(call => /UPDATE detection_events/.test(call.sql)));

  const stream = await fetch(`${base}/test-runs/${run.id}/stream`, { headers: adminHeaders });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /multipart\/x-mixed-replace; boundary=frame/);
  assert.equal(stream.headers.get('cache-control'), 'no-store');

  const frameChunks = [
    Buffer.from('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 4\r\n\r\ntest\r\n'),
    Buffer.from('--frame'),
    Buffer.from('--\r\n'),
  ];
  const deniedUpload = await fetch(`${base}/test-runs/${run.id}/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' },
    body: Buffer.concat(frameChunks),
  });
  assert.equal(deniedUpload.status, 401);

  const upload = await fetch(`${base}/test-runs/${run.id}/video`, {
    method: 'POST',
    headers: { ...aiHeaders, 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' },
    body: Readable.from(frameChunks),
    duplex: 'half',
  });
  assert.equal(upload.status, 200);
  assert.deepEqual(await upload.json(), { accepted: true });

  const reader = stream.body.getReader();
  const received = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received.push(Buffer.from(value));
  }
  assert.ok(Buffer.concat(received).includes(Buffer.from('Content-Type: image/jpeg')));

  child.child.emit('close', 0);
  const completed = await fetch(`${base}/test-runs/${run.id}`, { headers: adminHeaders });
  assert.equal((await completed.json()).status, 'completed');
});
