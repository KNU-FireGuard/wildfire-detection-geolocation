const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
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
  runnerPath = process.env.AI_LIVE_RUNNER_PATH || '',
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
  terminationGraceMs = 10000,
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

  function clearTimers() {
    if (restartTimer) clearTimeout(restartTimer);
    if (watchdog) clearInterval(watchdog);
    restartTimer = null;
    watchdog = null;
  }

  function status() {
    return {
      state: overall,
      cameras: slots.map(slot => ({
        camera_id: slot.cameraId, provider_key: slot.providerKey, name: slot.name,
        run_id: slot.run?.id ?? null, state: slot.state,
        last_frame_at: slot.lastFrameAt ? new Date(slot.lastFrameAt).toISOString() : null,
      })),
    };
  }

  function recordHeartbeat(runId, cameraId) {
    const slot = slots.find(item => item.run?.id === runId && item.cameraId === cameraId);
    if (!slot || !['starting', 'running'].includes(slot.state)) return false;
    slot.lastFrameAt = now();
    slot.state = 'running';
    if (slots.every(item => item.lastFrameAt)) {
      overall = 'running';
      restartCount = 0;
    }
    return true;
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
    restartTimer = setTimeout(() => { restartTimer = null; launch().catch(() => { overall = 'failed'; }); }, delay);
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
    if (!active) return;
    if (slots.length !== 6) { overall = 'waiting_for_cctv'; return; }
    if (!resolvedRunnerPath || !await canRun(resolvedRunnerPath)) {
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
    });
    const configuration = {
      result_url: `${baseUrl}/detections`,
      heartbeat_url: `${baseUrl}/live-monitor/heartbeat`,
      cameras: slots.map(slot => ({
        run_id: slot.run.id, camera_id: slot.cameraId, source_url: slot.streamUrl,
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
    overall = 'starting';
    child.stdout?.resume();
    child.stderr?.resume();
    child.stdin?.on('error', () => child.kill('SIGTERM'));
    child.stdin?.end(JSON.stringify(configuration));
    child.once('spawn', () => {
      if (worker !== child) return;
      slots.forEach(slot => { slot.run.status = 'running'; });
    });
    child.once('error', () => finishWorker(child, 'AI 작업자를 시작하지 못했습니다.'));
    child.once('close', code => finishWorker(child, `AI 작업자가 종료되었습니다. (code ${code})`));
    let terminationRequestedAt = null;
    watchdog = setInterval(() => {
      if (worker !== child) return;
      const stale = slots.some(slot => now() - (slot.lastFrameAt || slot.startedAt) > heartbeatTimeoutMs);
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
    const listing = await catalog.list();
    const items = listing.items || [];
    const valid = items.length === 6 && items.every(item =>
      Number.isSafeInteger(item.cameraId) && item.cameraId > 0
      && typeof item.streamUrl === 'string' && item.streamUrl.startsWith('https://'));
    const next = valid ? items.map(item => ({
      cameraId: item.cameraId, providerKey: item.providerKey, name: item.name,
      streamUrl: item.streamUrl, run: null, state: 'waiting_for_ai', lastFrameAt: null,
    })) : [];
    const same = JSON.stringify(slots.map(({ cameraId, streamUrl }) => [cameraId, streamUrl]))
      === JSON.stringify(next.map(({ cameraId, streamUrl }) => [cameraId, streamUrl]));
    if (same && (worker || restartTimer || overall === 'waiting_for_ai')) return status();
    clearTimers();
    if (worker) {
      const old = worker;
      worker = null;
      old.kill('SIGTERM');
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
    if (active) return status();
    active = true;
    await reconcile();
    return status();
  }

  async function stop() {
    active = false;
    clearTimers();
    const child = worker;
    worker = null;
    child?.kill('SIGTERM');
    for (const slot of slots) {
      await closeRun(slot, 'Backend 서버가 종료되었습니다.');
      slot.state = 'stopped';
    }
    overall = 'stopped';
  }

  return { start, stop, reconcile, status, recordHeartbeat };
}

module.exports = { createLiveMonitor };
