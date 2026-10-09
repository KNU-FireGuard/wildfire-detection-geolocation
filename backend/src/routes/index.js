const express = require('express');
const authRoutes = require('./auth.routes');
const detectionsRoutes = require('./detections.routes');
const testRunsRoutes = require('./runs.routes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use(testRunsRoutes);
router.use('/detections', detectionsRoutes);
router.use(require('./catalog.routes'));

module.exports = router;
