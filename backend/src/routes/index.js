const express = require('express');
const detectionsRoutes = require('./detections.routes');

const router = express.Router();

router.use('/detections', detectionsRoutes);

module.exports = router;
