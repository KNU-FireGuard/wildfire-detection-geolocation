const express = require('express');
const { requireAdmin } = require('../middleware/require-admin');
const { requireAiCallback } = require('../middleware/require-ai-callback');
const { catalog, monitor } = require('../services/live-cctv-runtime');
const pool = require('../config/db');

const router = express.Router();

router.get('/live-cctvs', async (req, res, next) => {
  try { res.json(await catalog.list()); } catch (error) { next(error); }
});

router.post('/live-cctvs/refresh', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('SELECT provider_key FROM cameras LIMIT 0');
    await pool.query('SELECT camera_id FROM detection_events LIMIT 0');
    const result = await catalog.refresh();
    await monitor.reconcile();
    res.json(result);
  }
  catch (error) {
    if (/이미 진행 중/.test(error.message)) return res.status(409).json({ error: error.message });
    if (/ITS_CCTV_API_KEY/.test(error.message)) return res.status(503).json({ error: error.message });
    if (/ITS CCTV|HLS CCTV/.test(error.message)) return res.status(502).json({ error: error.message });
    return next(error);
  }
});

router.get('/live-monitor/status', (req, res) => res.json(monitor.status()));

router.post('/live-monitor/heartbeat', requireAiCallback, (req, res) => {
  const { run_id: runId, camera_id: cameraId } = req.body || {};
  if (!Number.isSafeInteger(runId) || runId < 1 || !Number.isSafeInteger(cameraId) || cameraId < 1) {
    return res.status(400).json({ error: 'run_id와 camera_id는 양의 정수여야 합니다.' });
  }
  if (!monitor.recordHeartbeat(runId, cameraId)) {
    return res.status(404).json({ error: '실행 중인 카메라 감시 작업이 없습니다.' });
  }
  return res.status(202).json({ accepted: true });
});


module.exports = router;
