const { spawn } = require('node:child_process');
const { constants: fsConstants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('../config/db');
const { finalizeRunEvents } = require('../services/detection-events');
const testRuns = require('../services/run-manager');

const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const AI_RUNNER = path.join(PROJECT_ROOT, 'ai', 'inference', 'backend_connect.py');
const DEFAULT_MODEL = path.join(PROJECT_ROOT, 'ai', 'yolo26n_fire_50', 'weights', 'best.pt');
const FINAL_BOUNDARY = Buffer.from('--frame--\r\n');

function getModelPath() {
  return path.resolve(PROJECT_ROOT, process.env.AI_MODEL_PATH || DEFAULT_MODEL);
}

function positiveId(raw, label, max = 2147483647) {
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id < 1 || id > max) {
    return { error: `${label}는 1~${max}의 정수여야 합니다.` };
  }
  return { id };
}

async function resolveVideoPath(filePath) {
  const videoRoot = await fs.realpath(path.join(PROJECT_ROOT, 'data', 'videos'));
  const resolved = await fs.realpath(path.resolve(PROJECT_ROOT, filePath));
  const relative = path.relative(videoRoot, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('영상 경로가 허용된 폴더 밖입니다.');
  }
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error('영상 파일이 아닙니다.');
  await fs.access(resolved, fsConstants.R_OK);
  return resolved;
}

function attachProcess(run, child) {
  run.child = child;
  child.once('spawn', () => {
    if (run.status === 'ready') run.status = 'running';
  });
  child.once('error', () => testRuns.markFailed(run, 'AI 분석을 시작하지 못했습니다.'));
  child.once('close', async (code) => {
    const alreadyFailed = run.status === 'failed';
    try {
      await finalizeRunEvents(run);
    } catch {
      console.error(`[AI run=${run.id}] 탐지 이벤트 종료 시각을 저장하지 못했습니다.`);
      if (!alreadyFailed) {
        testRuns.markFailed(run, '탐지 이벤트 종료 시각을 저장하지 못했습니다.');
      }
      testRuns.closeSubscribers(run);
      return;
    }

    if (run.status === 'failed') {
      testRuns.closeSubscribers(run);
    } else if (code === 0 && run.videoFinished) {
      run.status = 'completed';
      run.error = null;
    } else if (run.status !== 'failed') {
      testRuns.markFailed(run, 'AI 분석에 실패했습니다.');
    }
    testRuns.closeSubscribers(run);
  });
  child.stdout?.on('data', chunk => process.stdout.write(`[AI run=${run.id}] ${chunk}`));
  child.stderr?.on('data', chunk => process.stderr.write(`[AI run=${run.id}] ${chunk}`));
}

function launchAi(run, sourcePath) {
  const port = Number(process.env.PORT || 3000);
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const python = process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3');
  const modelPath = getModelPath();
  const args = [
    AI_RUNNER,
    '--run-id', String(run.id),
    '--camera-id', String(run.camera_id),
    '--source-path', sourcePath,
    '--video-url', `${baseUrl}/test-runs/${run.id}/video`,
    '--result-url', `${baseUrl}/detections`,
    '--model-path', modelPath,
  ];

  try {
    const child = spawn(python, args, { cwd: PROJECT_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    attachProcess(run, child);
  } catch {
    testRuns.markFailed(run, 'AI 분석을 시작하지 못했습니다.');
  }
}

async function startTestRun(req, res) {
  const parsedCameraId = positiveId(req.params.camera_id, '카메라 ID');
  if (parsedCameraId.error) return res.status(400).json({ error: parsedCameraId.error });

  const { rows } = await pool.query(`
    SELECT c.id AS camera_id, c.source_type, v.id AS video_id, v.file_path
    FROM cameras c
    LEFT JOIN videos v ON v.camera_id = c.id
    WHERE c.id = $1
    ORDER BY v.id ASC
  `, [parsedCameraId.id]);
  if (rows.length === 0) return res.status(404).json({ error: '카메라가 없습니다.' });
  if (rows[0].source_type !== 'test') return res.status(409).json({ error: '테스트 카메라가 아닙니다.' });
  if (rows.length !== 1 || rows[0].video_id === null) {
    return res.status(409).json({ error: '카메라에 연결된 테스트 영상이 하나여야 합니다.' });
  }

  let sourcePath;
  try {
    sourcePath = await resolveVideoPath(rows[0].file_path);
    await fs.access(AI_RUNNER, fsConstants.R_OK);
    await fs.access(getModelPath(), fsConstants.R_OK);
  } catch {
    return res.status(409).json({ error: 'AI 실행 파일, 모델 또는 테스트 영상을 읽을 수 없습니다.' });
  }

  if (testRuns.hasActiveRun(rows[0].camera_id)) {
    return res.status(409).json({ error: '카메라 분석이 이미 실행 중입니다.' });
  }

  const run = testRuns.createRun({
    cameraId: rows[0].camera_id,
    videoId: rows[0].video_id,
    filePath: sourcePath,
  });
  launchAi(run, sourcePath);

  return res.status(202).json({
    id: run.id,
    camera_id: run.camera_id,
    video_id: run.video_id,
    status: run.status,
    stream_url: `/api/test-runs/${run.id}/stream`,
    status_url: `/api/test-runs/${run.id}`,
  });
}

function getTestRun(req, res) {
  const parsedRunId = positiveId(req.params.run_id, '실행 ID', Number.MAX_SAFE_INTEGER);
  if (parsedRunId.error) return res.status(400).json({ error: parsedRunId.error });
  const run = testRuns.getRun(parsedRunId.id);
  if (!run) return res.status(404).json({ error: '테스트 실행이 없습니다.' });
  return res.status(200).json(testRuns.publicStatus(run));
}

function streamTestRun(req, res) {
  const parsedRunId = positiveId(req.params.run_id, '실행 ID', Number.MAX_SAFE_INTEGER);
  if (parsedRunId.error) return res.status(400).json({ error: parsedRunId.error });
  const run = testRuns.getRun(parsedRunId.id);
  if (!run) return res.status(404).json({ error: '테스트 실행이 없습니다.' });
  if (['completed', 'failed'].includes(run.status) || run.videoFinished) {
    return res.status(409).json({ error: '영상 스트림이 종료되었습니다.' });
  }
  testRuns.subscribe(run, res);
}

async function receiveVideo(req, res) {
  const parsedRunId = positiveId(req.params.run_id, '실행 ID', Number.MAX_SAFE_INTEGER);
  if (parsedRunId.error) return res.status(400).json({ error: parsedRunId.error });
  const run = testRuns.getRun(parsedRunId.id);
  if (!run) return res.status(404).json({ error: '테스트 실행이 없습니다.' });
  if (run.videoUploadStarted || run.videoFinished || ['completed', 'failed'].includes(run.status)) {
    return res.status(409).json({ error: '영상 스트림을 받을 수 없는 상태입니다.' });
  }
  if (!/^multipart\/x-mixed-replace\s*;\s*boundary=frame(?:\s*;|\s*$)/i.test(req.get('content-type') || '')) {
    return res.status(400).json({ error: 'multipart/x-mixed-replace; boundary=frame 형식이어야 합니다.' });
  }

  run.videoUploadStarted = true;
  run.status = 'running';
  let bytes = 0;
  let tail = Buffer.alloc(0);
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      tail = Buffer.concat([tail, chunk]).subarray(-FINAL_BOUNDARY.length);
      await testRuns.publish(run, chunk);
    }
    if (bytes === 0 || !tail.equals(FINAL_BOUNDARY)) {
      testRuns.markFailed(run, 'MJPEG 스트림 형식이 올바르지 않습니다.');
      return res.status(400).json({ error: '종료 boundary가 없는 MJPEG 스트림입니다.' });
    }
    testRuns.finishUpload(run);
    return res.status(200).json({ accepted: true });
  } catch {
    testRuns.markFailed(run, 'AI 영상 전송이 중단되었습니다.');
    return res.status(500).json({ error: '영상 스트림 처리에 실패했습니다.' });
  }
}

module.exports = { getTestRun, receiveVideo, startTestRun, streamTestRun };
