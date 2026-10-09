const express = require('express');
const { receiveDetection } = require('../controllers/detections.controller');
const { requireAiCallback } = require('../middleware/require-ai-callback');

const router = express.Router();

router.post('/', requireAiCallback, receiveDetection);

module.exports = router;
