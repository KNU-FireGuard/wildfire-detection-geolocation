const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createLiveMonitor } = require('../src/services/live-monitor');

const cameras = Array.from({ length: 6 }, (_, index) => ({
  providerKey: String(index + 1).padStart(32, 'a'), cameraId: index + 1,
  name: `CCTV ${index + 1}`, streamUrl: `http://video.example.test/${index + 1}.m3u8`,
}));

function fakeRuns() {
  let id = 100;
  const runs = new Map();
  return {
    runs,
    createRun({ cameraId }) {
      const run = { id: id++, camera_id: cameraId, video_id: null, status: 'ready', eventIdsByClass: new Map() };
      runs.set(run.id, run);
      return run;
    },
    markFailed(run, message) { run.status = 'failed'; run.error = message; },
    removeRun(run) { runs.delete(run.id); },
  };
}

test('AI 실행 파일이 없으면 ITS 호출 없이 6개 카메라를 대기 상태로 표시한다', async () => {
  let lists = 0;
  const monitor = createLiveMonitor({
    catalog: { async list() { lists++; return { items: cameras }; } },
    runnerPath: '',
    spawnImpl() { assert.fail('AI 프로세스를 시작하면 안 됩니다.'); },
  });
  await monitor.start();
  assert.equal(lists, 1);
  assert.equal(monitor.status().cameras.length, 6);
  assert.ok(monitor.status().cameras.every(camera => camera.state === 'waiting_for_ai'));
  await monitor.stop();
});

test('Backend가 만든 실행 ID와 6개 영상 주소를 한 AI 작업자에 전달하고 종료 시 재시작한다', async () => {
  const children = [];
  const runManager = fakeRuns();
  const monitor = createLiveMonitor({
    catalog: { list: async () => ({ items: cameras }) },
    runnerPath: '/tmp/fake-live-ai.py',
    canRun: async () => true,
    runManager,
    finalizeEvents: async () => {},
    getToken: () => 'test-token',
    restartDelayMs: 5,
    spawnImpl(_command, args, options) {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => { child.killed = true; };
      child.input = '';
      child.stdin.on('data', chunk => { child.input += chunk; });
      children.push({ child, args, options });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  await monitor.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children.length, 1);
  const config = JSON.parse(children[0].child.input);
  assert.equal(config.cameras.length, 6);
  assert.deepEqual(config.cameras.map(camera => camera.run_id), [100, 101, 102, 103, 104, 105]);
  assert.equal(config.cameras[0].source_url, cameras[0].streamUrl);
  assert.equal(children[0].options.env.AI_CALLBACK_TOKEN, 'test-token');
  assert.ok(!children[0].options.env.ITS_CCTV_API_KEY);
  assert.ok(monitor.recordHeartbeat(100, 1));
  assert.equal(monitor.status().cameras[0].state, 'running');
  children[0].child.emit('close', 1);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(children.length, 2);
  assert.equal(runManager.runs.size, 6);
  await monitor.stop();
  assert.equal(children[1].child.killed, true);
  assert.equal(runManager.runs.size, 0);
});

test('프레임 상태 신호가 끊기면 작업자를 종료해 재시작 대상으로 만든다', async () => {
  let current = 1000;
  let killed = false;
  const monitor = createLiveMonitor({
    catalog: { list: async () => ({ items: cameras }) },
    runnerPath: '/tmp/fake-live-ai.py', canRun: async () => true,
    runManager: fakeRuns(), finalizeEvents: async () => {}, getToken: () => 'test-token',
    now: () => current, heartbeatTimeoutMs: 10, watchdogIntervalMs: 5,
    restartDelayMs: 1000,
    spawnImpl() {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => { killed = true; queueMicrotask(() => child.emit('close', 1)); };
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  await monitor.start();
  current += 11;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(killed, true);
  assert.equal(monitor.status().state, 'restarting');
  await monitor.stop();
});

test('AI 프로세스 실행이 즉시 실패해도 재시도한다', async () => {
  let attempts = 0;
  const monitor = createLiveMonitor({
    catalog: { list: async () => ({ items: cameras }) },
    runnerPath: '/tmp/fake-live-ai.py', canRun: async () => true,
    runManager: fakeRuns(), finalizeEvents: async () => {}, getToken: () => 'test-token',
    restartDelayMs: 5,
    spawnImpl() {
      attempts++;
      if (attempts === 1) throw new Error('spawn failed');
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {};
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  await monitor.start();
  assert.equal(monitor.status().state, 'restarting');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(attempts, 2);
  await monitor.stop();
});

test('종료 신호에 응답하지 않는 AI 작업자를 강제 종료한다', async () => {
  let current = 1000;
  const signals = [];
  const monitor = createLiveMonitor({
    catalog: { list: async () => ({ items: cameras }) },
    runnerPath: '/tmp/fake-live-ai.py', canRun: async () => true,
    runManager: fakeRuns(), finalizeEvents: async () => {}, getToken: () => 'test-token',
    now: () => current, heartbeatTimeoutMs: 10, watchdogIntervalMs: 5,
    terminationGraceMs: 10, restartDelayMs: 1000,
    spawnImpl() {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = signal => {
        signals.push(signal);
        if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', 1));
      };
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  });
  await monitor.start();
  current += 11;
  await new Promise(resolve => setTimeout(resolve, 12));
  current += 11;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(monitor.status().state, 'restarting');
  await monitor.stop();
});
