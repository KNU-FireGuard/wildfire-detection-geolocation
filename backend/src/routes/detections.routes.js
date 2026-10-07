const express = require('express');
const { receiveDetection } = require('../controllers/detections.controller');

const router = express.Router();

router.post('/', receiveDetection);

module.exports = router;
