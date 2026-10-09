const runs = new Map();
let nextRunId = Date.now();

function createRun({ cameraId, videoId, filePath }) {
  const run = {
    id: nextRunId++,
    camera_id: cameraId,
    video_id: videoId,
    file_path: filePath,
    status: 'ready',
    error: null,
    child: null,
    videoUploadStarted: false,
    videoFinished: false,
    subscribers: new Set(),
    eventIdsByClass: new Map(),
  };
  runs.set(run.id, run);
  return run;
}

function getRun(id) {
  return runs.get(id) || null;
}

function hasActiveRun(cameraId) {
  return [...runs.values()].some(run => (
    run.camera_id === cameraId && ['ready', 'running'].includes(run.status)
  ));
}

function publicStatus(run) {
  return {
    id: run.id,
    camera_id: run.camera_id,
    video_id: run.video_id,
    status: run.status,
    error: run.error,
  };
}

function subscribe(run, response) {
  run.subscribers.add(response);
  response.on('close', () => run.subscribers.delete(response));
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  if (run.videoFinished || ['completed', 'failed'].includes(run.status)) {
    run.subscribers.delete(response);
    response.end();
  }
}

async function publish(run, chunk) {
  const subscribers = [...run.subscribers];
  await Promise.all(subscribers.map((response) => new Promise((resolve) => {
    if (response.destroyed || response.writableEnded) {
      run.subscribers.delete(response);
      resolve();
      return;
    }
    if (response.write(chunk)) {
      resolve();
      return;
    }
    const done = () => {
      response.off('drain', done);
      response.off('close', done);
      resolve();
    };
    response.once('drain', done);
    response.once('close', done);
  })));
}

function closeSubscribers(run) {
  for (const response of run.subscribers) response.end();
  run.subscribers.clear();
}

function markFailed(run, message) {
  run.status = 'failed';
  run.error = message;
  closeSubscribers(run);
}

function stopAll() {
  for (const run of runs.values()) {
    if (['ready', 'running'].includes(run.status)) {
      run.child?.kill('SIGTERM');
      markFailed(run, 'Backend 서버가 종료되어 분석이 중단되었습니다.');
    }
  }
}

function finishUpload(run) {
  run.videoFinished = true;
  closeSubscribers(run);
}

module.exports = {
  closeSubscribers,
  createRun,
  finishUpload,
  getRun,
  hasActiveRun,
  markFailed,
  publicStatus,
  publish,
  stopAll,
  subscribe,
};
