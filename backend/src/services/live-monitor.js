const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createInterface } = require('node:readline');
const runManagerDefault = require('./run-manager');
const { finalizeRunEvents } = require('./detection-events');
const { getAiCallbackToken } = require('../middleware/require-ai-callback');

const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const ENV_KEYS = [
  'PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'SystemDrive', 'COMSPEC',
  'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL',
  'CUDA_VISIBLE_DEVICES', 'CUDA_PATH', 'CUDA_HOME', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH',
  'OMP_NUM_THREADS',
];

async function fileIsReadable(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

function createLiveMonitor({
  catalog,
  runnerPath = process.env.AI_LIVE_RUNNER_PATH || 'ai/inference/live_runner.py',
  python = process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3'),
  spawnImpl = spawn,
  canRun = fileIsReadable,
  runManager = runManagerDefault,
  finalizeEvents = finalizeRunEvents,
  getToken = getAiCallbackToken,
  now = () => Date.now(),
  restartDelayMs = 10000,
  heartbeatTimeoutMs = 120000,
  watchdogIntervalMs = 30000,
  terminationGraceMs = 5000,
} = {}) {
  if (!catalog) throw new Error('ITS CCTV 목록이 필요합니다.');
  const resolvedRunnerPath = runnerPath ? path.resolve(PROJECT_ROOT, runnerPath) : '';
  let active = false;
  let worker = null;
  let restartTimer = null;
  let watchdog = null;
  let restartCount = 0;
  let slots = [];
  let overall = 'stopped';
  let lifecycle = Promise.resolve();
  let controlVersion = 0;
  const closedWorkers = new WeakSet();
  let workerStartedAt = null;
  let workerHeartbeatAt = null;
  let workerProgressAt = null;
  let hasWorkerStatus = false;

  function serialize(operation) {
    const result = lifecycle.then(operation);
    lifecycle = result.catch(() => {});
    return result;
  }

  function terminateWorker(child) {
    if (closedWorkers.has(child)) return Promise.resolve();
    return new Promise(resolve => {
      // Register before signalling so a quick exit cannot be missed.
      const timer = setTimeout(() => child.kill('SIGKILL'), terminationGraceMs);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  function clearTimers() {
    if (restartTimer) clearTimeout(restartTimer);
    if (watchdog) clearInterval(watchdog);
    restartTimer = null;
    watchdog = null;
  }

  function status() {
    return {
      enabled: active,
      state: overall,
      last_worker_heartbeat_at: workerHeartbeatAt === null ? null : new Date(workerHeartbeatAt).toISOString(),
      cameras: slots.map(slot => ({
        camera_id: slot.cameraId, provider_key: slot.providerKey, name: slot.name,
        run_id: slot.run?.id ?? null, state: slot.state,
        last_frame_at: slot.lastFrameAt == null ? null : new Date(slot.lastFrameAt).toISOString(),
        last_analysis_at: slot.lastAnalysisAt == null ? null : new Date(slot.lastAnalysisAt).toISOString(),
      })),
    };
  }

  function recordHeartbeat(runId, cameraId) {
    if (!active) return false;
    const slot = slots.find(item => item.run?.id === runId && item.cameraId === cameraId);
    if (!slot || ['stopped', 'restarting'].includes(slot.state)) return false;
    workerHeartbeatAt = now();
    if (!hasWorkerStatus) workerProgressAt = workerHeartbeatAt;
    slot.lastFrameAt = now();
    slot.state = 'running';
    if (slots.every(item => item.lastFrameAt)) {
      overall = 'running';
      restartCount = 0;
    }
    return true;
  }

  function recordWorkerStatus(child, message) {
    if (!active || worker !== child || message?.type !== 'live_status') return;
    const validAge = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
      && Number.isFinite(new Date(now() - value).getTime());
    if (!validAge(message.progress_age_ms) || !Array.isArray(message.cameras)
      || message.cameras.length !== slots.length) return;
    const seen = new Set();
    const updates = [];
    for (const item of message.cameras) {
      const slot = slots.find(candidate => candidate.cameraId === item.camera_id && candidate.run?.id === item.run_id);
      if (!slot || seen.has(item.camera_id)
        || !['connecting', 'receiving', 'stream_error'].includes(item.stream_state)
        || !(item.frame_age_ms === null || validAge(item.frame_age_ms))
        || !(item.analysis_age_ms === null || validAge(item.analysis_age_ms))
        || typeof item.analysis_delayed !== 'boolean') return;
      seen.add(item.camera_id);
      updates.push([slot, item]);
    }
    const current = now();
    hasWorkerStatus = true;
    workerHeartbeatAt = current;
    workerProgressAt = current - message.progress_age_ms;
    for (const [slot, item] of updates) {
      slot.lastFrameAt = item.frame_age_ms === null ? null : current - item.frame_age_ms;
      slot.lastAnalysisAt = item.analysis_age_ms === null ? null : current - item.analysis_age_ms;
      slot.state = item.stream_state === 'connecting' ? 'connecting'
        : item.stream_state === 'stream_error' || item.frame_age_ms === null || item.frame_age_ms > 15000 ? 'stream_error'
          : item.analysis_delayed || item.analysis_age_ms === null || item.analysis_age_ms > 5000 ? 'analysis_delayed'
            : 'running';
    }
    if (slots.every(slot => slot.state === 'running')) { overall = 'running'; restartCount = 0; }
    else if (slots.every(slot => slot.state === 'connecting')) overall = 'connecting';
    else if (slots.every(slot => slot.state === 'stream_error')) overall = 'stream_error';
    else if (slots.some(slot => ['connecting', 'stream_error'].includes(slot.state))) overall = 'degraded';
    else overall = 'analysis_delayed';
  }

  async function closeRun(slot, message) {
    if (!slot.run) return;
    runManager.markFailed(slot.run, message);
    try { await finalizeEvents(slot.run); }
    catch { console.error(`[AI live camera=${slot.cameraId}] 탐지 이벤트 종료 실패`); }
    runManager.removeRun(slot.run);
    slot.run = null;
  }

  function scheduleRestart() {
    if (!active) { overall = 'stopped'; return; }
    overall = 'restarting';
    slots.forEach(slot => { slot.state = 'restarting'; });
    const delay = Math.min(restartDelayMs * 2 ** restartCount, 300000);
    restartCount = Math.min(restartCount + 1, 5);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      serialize(launch).catch(() => { overall = 'failed'; });
    }, delay);
    restartTimer.unref?.();
  }

  async function finishWorker(child, message) {
    if (worker !== child) return;
    worker = null;
    clearTimers();
    for (const slot of slots) {
      await closeRun(slot, message);
      slot.state = active ? 'restarting' : 'stopped';
    }
    scheduleRestart();
  }

  async function launch() {
    if (!active || worker) return;
    if (slots.length !== 6) { overall = 'waiting_for_cctv'; return; }
    const runnable = resolvedRunnerPath && await canRun(resolvedRunnerPath);
    if (!active) return;
    if (!runnable) {
      overall = 'waiting_for_ai';
      slots.forEach(slot => { slot.state = 'waiting_for_ai'; });
      return;
    }
    const port = Number(process.env.PORT || 3000);
    const baseUrl = `http://127.0.0.1:${port}/api`;
    const env = {};
    for (const key of ENV_KEYS) if (typeof process.env[key] === 'string') env[key] = process.env[key];
    env.AI_CALLBACK_TOKEN = getToken();
    slots.forEach(slot => {
      slot.run = runManager.createRun({ cameraId: slot.cameraId, videoId: null });
      slot.state = 'starting';
      slot.lastFrameAt = null;
      slot.lastAnalysisAt = null;
    });
    const configuration = {
      result_url: `${baseUrl}/detections`,
      heartbeat_url: `${baseUrl}/live-monitor/heartbeat`,
      model_path: path.resolve(PROJECT_ROOT, process.env.AI_MODEL_PATH || 'ai/weights/yolo26s_final/weights/best.pt'),
      cameras: slots.map(slot => ({
        run_id: slot.run.id, camera_id: slot.cameraId, source_url: slot.streamUrl,
        name: slot.name, latitude: slot.latitude, longitude: slot.longitude,
      })),
    };
    let child;
    try {
      child = spawnImpl(python, [resolvedRunnerPath], {
        cwd: PROJECT_ROOT, env, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      for (const slot of slots) await closeRun(slot, 'AI 작업자를 시작하지 못했습니다.');
      scheduleRestart();
      return;
    }
    worker = child;
    workerStartedAt = now();
    workerHeartbeatAt = null;
    workerProgressAt = null;
    hasWorkerStatus = false;
    overall = 'starting';
    if (child.stdout) {
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        try { recordWorkerStatus(child, JSON.parse(line)); }
        catch { /* YOLO and location libraries also write non-status output. */ }
      });
      child.once('close', () => lines.close());
    }
    child.stdout?.resume();
    child.stderr?.on('data', chunk => process.stderr.write(`[AI live] ${chunk}`));
    child.stdin?.on('error', () => child.kill('SIGTERM'));
    child.stdin?.end(JSON.stringify(configuration));
    child.once('spawn', () => {
      if (worker !== child) return;
      slots.forEach(slot => { slot.run.status = 'running'; });
    });
    const finish = message => serialize(() => finishWorker(child, message))
      .catch(() => { overall = 'failed'; });
    child.once('error', () => finish('AI 작업자를 시작하지 못했습니다.'));
    child.once('close', code => {
      // Remember close immediately, even while lifecycle cleanup is queued.
      closedWorkers.add(child);
      finish(`AI 작업자가 종료되었습니다. (code ${code})`);
    });
    let terminationRequestedAt = null;
    watchdog = setInterval(() => {
      if (worker !== child) return;
      // Receiver threads reconnect each stream. Only a silent/stalled worker
      // warrants restarting the shared model and all cameras.
      const stale = now() - (workerHeartbeatAt ?? workerStartedAt) > heartbeatTimeoutMs
        || now() - (workerProgressAt ?? workerStartedAt) > heartbeatTimeoutMs;
      if (!stale) return;
      if (terminationRequestedAt === null) {
        terminationRequestedAt = now();
        child.kill('SIGTERM');
      } else if (now() - terminationRequestedAt > terminationGraceMs) {
        child.kill('SIGKILL');
      }
    }, watchdogIntervalMs);
    watchdog.unref?.();
    const startedAt = now();
    slots.forEach(slot => { slot.startedAt = startedAt; });
  }

  async function reconcile() {
    if (!active) return status();
    const listing = await catalog.list();
    if (!active) return status();
    const items = listing.items || [];
    const valid = items.length === 6 && items.every(item =>
      Number.isSafeInteger(item.cameraId) && item.cameraId > 0
      && typeof item.streamUrl === 'string' && /^https?:\/\//.test(item.streamUrl));
    const next = valid ? items.map(item => ({
      cameraId: item.cameraId, providerKey: item.providerKey, name: item.name,
      latitude: item.latitude ?? null, longitude: item.longitude ?? null,
      streamUrl: item.streamUrl, run: null, state: 'waiting_for_ai', lastFrameAt: null,
    })) : [];
    const same = JSON.stringify(slots.map(({ cameraId, streamUrl }) => [cameraId, streamUrl]))
      === JSON.stringify(next.map(({ cameraId, streamUrl }) => [cameraId, streamUrl]));
    if (same && (worker || restartTimer || overall === 'waiting_for_ai')) return status();
    clearTimers();
    if (worker) {
      const old = worker;
      worker = null;
      await terminateWorker(old);
      for (const slot of slots) {
        await closeRun(slot, 'CCTV 목록이 갱신되었습니다.');
      }
    }
    slots = next;
    restartCount = 0;
    await launch();
    return status();
  }

  async function start() {
    const version = ++controlVersion;
    return serialize(async () => {
      if (version !== controlVersion || active) return status();
      active = true;
      try { return await reconcile(); }
      catch (error) {
        active = false;
        clearTimers();
        overall = 'failed';
        throw error;
      }
    });
  }

  async function stop() {
    active = false;
    clearTimers();
    const child = worker;
    worker = null;
    if (child) await terminateWorker(child);
    for (const slot of slots) {
      await closeRun(slot, '실시간 탐지가 중지되었습니다.');
      slot.state = 'stopped';
    }
    overall = 'stopped';
  }

  return {
    start,
    stop: () => {
      // Block launches immediately, even while a reconciliation is still waiting.
      controlVersion += 1;
      active = false;
      overall = 'stopping';
      clearTimers();
      return serialize(stop);
    },
    reconcile: () => serialize(reconcile),
    status, recordHeartbeat,
  };
}

module.exports = { createLiveMonitor };
