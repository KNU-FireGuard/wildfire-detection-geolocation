const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { PassThrough, Readable } = require('node:stream');
const fs = require('node:fs/promises');
const path = require('node:path');

const originalDbPassword = process.env.DB_PASSWORD;
process.env.JWT_SECRET = 'test-only-jwt-secret-with-more-than-32-characters';
process.env.AI_CALLBACK_TOKEN = 'test-only-ai-callback-token-with-32-bytes';
process.env.DB_PASSWORD = 'test-only-db-password';
process.env.PORT = '3000';
delete process.env.AI_MODEL_PATH;

const fixtureFilename = `test-run-${randomUUID()}.mp4`;
const fixturePath = path.resolve(__dirname, '../../data/videos', fixtureFilename);
const expectedModelPath = path.resolve(__dirname, '../../ai/weights/yolo26s_final/weights/best.pt');
const originalAccess = fs.access;
fs.access = (file, ...args) => file === expectedModelPath
  ? Promise.resolve()
  : originalAccess(file, ...args);
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
        const base = { source_type: 'test', video_id: 7, file_path: `data/videos/${fixtureFilename}` };
        // 카메라 2는 DB에 위경도가 없는 테스트 카메라
        if (params[0] === 2) return { rows: [{ ...base, camera_id: 2, name: '좌표 없음', latitude: null, longitude: null }] };
        return { rows: [{ ...base, camera_id: 1, name: '경북의성', latitude: 36.382, longitude: 128.5779 }] };
      }
      if (/INSERT INTO detection_events/.test(sql)) return { rows: [{ id: 91 }] };
      if (/UPDATE detection_events/.test(sql)) return { rows: [{ id: params[0] }] };
      if (/e\.acknowledged_at IS NULL/.test(sql)) return { rows: [] };
      // 화재 알림 조회는 카메라가 없는 것으로 처리해 발송과 기록을 건너뜀
      if (/FROM cameras WHERE id/.test(sql)) return { rows: [] };
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
  fs.access = originalAccess;
  if (originalDbPassword === undefined) delete process.env.DB_PASSWORD;
  else process.env.DB_PASSWORD = originalDbPassword;
});

test('Test API는 로그인 없이 시작·조회·영상 중계를 허용하고 AI 콜백은 인증한다', async () => {
  const started = await fetch(`${base}/cameras/1/test-runs`, { method: 'POST' });
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

  const duplicate = await fetch(`${base}/cameras/1/test-runs`, { method: 'POST' });
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
  assert.equal(child.args[child.args.indexOf('--model-path') + 1], expectedModelPath);
  // 위치 추정용: 카메라 이름(보정 설정 조회)과 DB 위경도(광선 출발점)
  assert.equal(child.args[child.args.indexOf('--camera-name') + 1], '경북의성');
  assert.equal(child.args[child.args.indexOf('--camera-lat') + 1], '36.382');
  assert.equal(child.args[child.args.indexOf('--camera-lon') + 1], '128.5779');
  assert.equal(child.options.env.AI_CALLBACK_TOKEN, process.env.AI_CALLBACK_TOKEN);
  assert.equal(child.options.env.PATH, process.env.PATH);
  assert.equal(Object.hasOwn(child.options.env, 'DB_PASSWORD'), false);
  assert.equal(Object.hasOwn(child.options.env, 'JWT_SECRET'), false);

  const status = await fetch(`${base}/test-runs/${run.id}`);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).status, 'running');

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

  const stream = await fetch(`${base}/test-runs/${run.id}/stream`);
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
  const completed = await fetch(`${base}/test-runs/${run.id}`);
  assert.equal((await completed.json()).status, 'completed');
  assert.ok(queryCalls.some(call => (
    /UPDATE detection_events/.test(call.sql)
    && /ended_at = GREATEST\(started_at, updated_at\)/.test(call.sql)
    && /id = ANY\(\$1::INTEGER\[\]\)/.test(call.sql)
  )));
});

test('DB에 위경도가 없는 카메라는 위치 인자를 넘기지 않는다', async () => {
  const started = await fetch(`${base}/cameras/2/test-runs`, { method: 'POST' });
  assert.equal(started.status, 202);
  await new Promise(resolve => setImmediate(resolve));
  const child = spawned.at(-1);
  assert.equal(child.args[child.args.indexOf('--camera-id') + 1], '2');
  assert.equal(child.args[child.args.indexOf('--camera-name') + 1], '좌표 없음');
  assert.equal(child.args.includes('--camera-lat'), false);
  assert.equal(child.args.includes('--camera-lon'), false);
  child.child.emit('close', 0);
});
