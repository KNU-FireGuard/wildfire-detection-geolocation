const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_CALLBACK_TOKEN = 'test-only-ai-callback-token-with-32-bytes';

const queryCalls = [];
// 테스트별로 바꾸는 DB 응답: 갱신 대상 이벤트가 아직 진행 중인지, 같은 카메라에 알림 중인 화재가 있는지
const db = { updateRows: null, alertingRows: [] };
const dbPath = require.resolve('../src/config/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    async query(sql, params = []) {
      queryCalls.push({ sql, params });
      if (/INSERT INTO detection_events/.test(sql)) return { rows: [{ id: 1 }] };
      if (/UPDATE detection_events/.test(sql)) return { rows: db.updateRows ?? [{ id: params[0] }] };
      if (/e\.acknowledged_at IS NULL/.test(sql)) return { rows: db.alertingRows };
      // 화재 알림 조회는 카메라가 없는 것으로 처리해 발송과 기록을 건너뜀
      if (/FROM cameras WHERE id/.test(sql)) return { rows: [] };
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
  const insert = queryCalls.find(call => /INSERT INTO detection_events/.test(call.sql));
  assert.match(insert.sql, /CURRENT_TIMESTAMP, NULL, \$4/);
  assert.deepEqual(insert.params.slice(0, 2), [7, null]);
});

test('실시간 실행의 탐지 이벤트는 영상 ID 대신 카메라 ID에 연결한다', async () => {
  const liveRun = testRuns.createRun({ cameraId: 42, videoId: null, sourceUrl: 'https://video.example.test/live.m3u8' });
  const response = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AI-Token': process.env.AI_CALLBACK_TOKEN },
    body: JSON.stringify({ ...payload, run_id: liveRun.id, camera_id: 42 }),
  });
  assert.equal(response.status, 202);
  const insert = queryCalls.findLast(call => /INSERT INTO detection_events/.test(call.sql));
  assert.deepEqual(insert.params.slice(0, 2), [null, 42]);
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
  const update = queryCalls.filter(call => /UPDATE detection_events/.test(call.sql)).at(-1);
  assert.match(update.sql, /COALESCE\(\$3, estimated_latitude\)/);
  assert.match(update.sql, /COALESCE\(\$4, estimated_longitude\)/);

  const noLocationResponse = await fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-AI-Token': process.env.AI_CALLBACK_TOKEN,
    },
    body: JSON.stringify(payload),
  });
  assert.equal(noLocationResponse.status, 202);
  const noLocationUpdate = queryCalls.filter(call => /UPDATE detection_events/.test(call.sql)).at(-1);
  assert.equal(noLocationUpdate.params[2], null);
  assert.match(noLocationUpdate.sql, /COALESCE\(\$3, estimated_latitude\)/);
});

test('fire 이벤트가 처음 생성될 때만 화재 알림을 요청한다', async () => {
  const fireAlert = require('../src/services/fire-alert');
  const original = fireAlert.notifyFireDetected;
  const alerts = [];
  fireAlert.notifyFireDetected = async alert => { alerts.push(alert); };
  const post = body => fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AI-Token': process.env.AI_CALLBACK_TOKEN },
    body: JSON.stringify(body),
  });
  try {
    const alertRun = testRuns.createRun({ cameraId: 5, videoId: 8, filePath: '/tmp/alert.mp4' });
    const fire = { ...payload, run_id: alertRun.id, camera_id: 5 };
    const smoke = { ...fire, detection: { ...fire.detection, class: 'smoke' } };

    assert.equal((await post(smoke)).status, 202);
    assert.equal(alerts.length, 0, 'smoke는 화면 표시만 하고 문자를 보내지 않는다');

    assert.equal((await post(fire)).status, 202);
    assert.equal(alerts.length, 1);
    assert.deepEqual(alerts[0], { cameraId: 5, eventId: 1, confidence: 0.94 });

    assert.equal((await post(fire)).status, 202);
    assert.equal(alerts.length, 1, '같은 실행의 반복 탐지는 문자를 다시 보내지 않는다');
  } finally {
    fireAlert.notifyFireDetected = original;
  }
});

test('화재 알림이 실패해도 탐지 결과는 202로 저장된다', async () => {
  const fireAlert = require('../src/services/fire-alert');
  const original = fireAlert.notifyFireDetected;
  fireAlert.notifyFireDetected = async () => { throw new Error('sms down'); };
  const originalError = console.error;
  console.error = () => {};
  try {
    const failRun = testRuns.createRun({ cameraId: 6, videoId: 9, filePath: '/tmp/fail.mp4' });
    const response = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-AI-Token': process.env.AI_CALLBACK_TOKEN },
      body: JSON.stringify({ ...payload, run_id: failRun.id, camera_id: 6 }),
    });
    assert.equal(response.status, 202);
  } finally {
    fireAlert.notifyFireDetected = original;
    console.error = originalError;
  }
});

function postDetection(body) {
  return fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AI-Token': process.env.AI_CALLBACK_TOKEN },
    body: JSON.stringify(body),
  });
}

async function withAlertSpy(fn) {
  const fireAlert = require('../src/services/fire-alert');
  const original = fireAlert.notifyFireDetected;
  const alerts = [];
  fireAlert.notifyFireDetected = async alert => { alerts.push(alert); };
  try { await fn(alerts); } finally { fireAlert.notifyFireDetected = original; db.updateRows = null; db.alertingRows = []; }
}

test('실시간 탐지를 위치 없이 먼저 저장한 뒤 같은 실행의 위치를 보완해도 이벤트·문자는 한 번만 생성한다', async () => {
  await withAlertSpy(async alerts => {
    const liveRun = testRuns.createRun({ cameraId: 11, videoId: null });
    const body = { ...payload, run_id: liveRun.id, camera_id: 11 };
    const before = queryCalls.length;
    assert.equal((await postDetection(body)).status, 202);
    assert.equal(alerts.length, 1, '위치 계산을 기다리지 않고 화재 알림을 요청한다');
    const location = { latitude: 36.4, longitude: 128.6, error_range_m: 100 };
    assert.equal((await postDetection({ ...body, location_estimation: location })).status, 202);
    const calls = queryCalls.slice(before);
    assert.equal(calls.filter(call => /INSERT INTO detection_events/.test(call.sql)).length, 1);
    const update = calls.find(call => /UPDATE detection_events/.test(call.sql));
    assert.deepEqual(update.params.slice(2), [36.4, 128.6, 100]);
    assert.equal(alerts.length, 1, '위치 보완은 추가 문자를 요청하지 않는다');
  });
});

test('같은 카메라에 확인하지 않은 화재가 알림 중이면 새 실행의 fire 이벤트는 만들되 문자는 보내지 않는다', async () => {
  await withAlertSpy(async alerts => {
    db.alertingRows = [{ '?column?': 1 }];
    const restarted = testRuns.createRun({ cameraId: 7, videoId: null, sourceUrl: 'https://video.example.test/live.m3u8' });
    const before = queryCalls.length;
    assert.equal((await postDetection({ ...payload, run_id: restarted.id, camera_id: 7 })).status, 202);
    const calls = queryCalls.slice(before);
    assert.ok(calls.some(call => /INSERT INTO detection_events/.test(call.sql)), '이벤트는 저장한다');
    const check = calls.find(call => /e\.acknowledged_at IS NULL/.test(call.sql));
    assert.deepEqual(check.params, [7]);
    assert.match(check.sql, /INTERVAL '30 minutes'/);
    assert.equal(alerts.length, 0);
  });
});

test('알림 중인 화재가 없으면(파랑에서 빨강으로 바뀔 때) 문자를 보낸다', async () => {
  await withAlertSpy(async alerts => {
    const fresh = testRuns.createRun({ cameraId: 8, videoId: null, sourceUrl: 'https://video.example.test/live.m3u8' });
    assert.equal((await postDetection({ ...payload, run_id: fresh.id, camera_id: 8 })).status, 202);
    assert.equal(alerts.length, 1);
  });
});

test('마지막 탐지 후 30분이 지난 이벤트는 갱신하지 않고 새 이벤트로 만들어 다시 알린다', async () => {
  await withAlertSpy(async alerts => {
    const longRun = testRuns.createRun({ cameraId: 9, videoId: null, sourceUrl: 'https://video.example.test/live.m3u8' });
    const body = { ...payload, run_id: longRun.id, camera_id: 9 };
    assert.equal((await postDetection(body)).status, 202);
    assert.equal(alerts.length, 1);
    // 두 번째 탐지: 기존 이벤트가 30분 넘게 조용해 갱신 대상이 없음
    db.updateRows = [];
    const before = queryCalls.length;
    assert.equal((await postDetection(body)).status, 202);
    const calls = queryCalls.slice(before);
    const update = calls.find(call => /UPDATE detection_events/.test(call.sql));
    assert.match(update.sql, /COALESCE\(ended_at, updated_at\) > CURRENT_TIMESTAMP - INTERVAL '30 minutes'/);
    assert.ok(calls.some(call => /INSERT INTO detection_events/.test(call.sql)), '새 이벤트를 만든다');
    assert.equal(alerts.length, 2);
  });
});

test('30분 안에 계속 오는 탐지는 기존 이벤트를 갱신하고 문자를 다시 보내지 않는다', async () => {
  await withAlertSpy(async alerts => {
    const steady = testRuns.createRun({ cameraId: 10, videoId: null, sourceUrl: 'https://video.example.test/live.m3u8' });
    const body = { ...payload, run_id: steady.id, camera_id: 10 };
    await postDetection(body);
    const before = queryCalls.length;
    await postDetection(body);
    assert.ok(!queryCalls.slice(before).some(call => /INSERT INTO detection_events/.test(call.sql)));
    assert.equal(alerts.length, 1);
  });
});
