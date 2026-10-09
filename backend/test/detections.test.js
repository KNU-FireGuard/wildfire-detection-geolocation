const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_CALLBACK_TOKEN = 'test-only-ai-callback-token-with-32-bytes';

const queryCalls = [];
const dbPath = require.resolve('../src/config/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    async query(sql, params = []) {
      queryCalls.push({ sql, params });
      if (/INSERT INTO detection_events/.test(sql)) return { rows: [{ id: 1 }] };
      if (/UPDATE detection_events/.test(sql)) return { rows: [{ id: params[0] }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  },
};

const testRuns = require('../src/services/run-manager');
const run = testRuns.createRun({ cameraId: 1, videoId: 7, filePath: '/tmp/test.mp4' });

const app = require('../src/app');
let server;
let base;

const payload = {
  run_id: run.id,
  camera_id: 1,
  detection: {
    class: 'fire',
    confidence: 0.94,
    bbox: { x1: 420, y1: 210, x2: 550, y2: 300 },
  },
  location_estimation: null,
};

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}/api/detections`;
});

after(() => server && new Promise(resolve => server.close(resolve)));

test('AI 토큰이 없거나 틀리면 탐지 결과를 거부한다', async () => {
  for (const token of [undefined, 'wrong-token']) {
    const response = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-AI-Token': token } : {}),
      },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 401);
  }
});

test('명세의 탐지 JSON을 검증하고 202 accepted를 반환한다', async () => {
  const response = await fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Token': process.env.AI_CALLBACK_TOKEN,
    },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.ok(queryCalls.some(call => /INSERT INTO detection_events/.test(call.sql)));
});

test('탐지 결과의 run ID, 클래스, confidence, bbox를 검증한다', async () => {
  const invalidPayloads = [
    { ...payload, run_id: 0 },
    { ...payload, detection: { ...payload.detection, class: 'other' } },
    { ...payload, detection: { ...payload.detection, confidence: 1.1 } },
    { ...payload, detection: { ...payload.detection, bbox: { ...payload.detection.bbox, x1: '420' } } },
  ];

  for (const body of invalidPayloads) {
    const response = await fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AI-Token': process.env.AI_CALLBACK_TOKEN,
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.ok(Array.isArray((await response.json()).details));
  }
});

test('위치 추정은 null 또는 유효한 좌표 객체를 허용한다', async () => {
  const response = await fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Token': process.env.AI_CALLBACK_TOKEN,
    },
    body: JSON.stringify({
      ...payload,
      location_estimation: {
        latitude: 35.1,
        longitude: 128.1,
        error_range_m: null,
      },
    }),
  });

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
});
