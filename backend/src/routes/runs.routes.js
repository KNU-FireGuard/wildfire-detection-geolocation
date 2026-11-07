const express = require('express');
const { getTestRun, receiveVideo, startTestRun, streamTestRun } = require('../controllers/runs.controller');
const { requireAiCallback } = require('../middleware/require-ai-callback');

const router = express.Router();

router.post('/cameras/:camera_id/test-runs', startTestRun);
router.get('/test-runs/:run_id/stream', streamTestRun);
router.get('/test-runs/:run_id', getTestRun);
router.post('/test-runs/:run_id/video', requireAiCallback, receiveVideo);

module.exports = router;
