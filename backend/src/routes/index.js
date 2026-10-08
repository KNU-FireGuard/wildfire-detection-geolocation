const express = require('express');
const detectionsRoutes = require('./detections.routes');

const router = express.Router();

router.use('/detections', detectionsRoutes);
router.use(require('./catalog.routes'));

module.exports = router;
