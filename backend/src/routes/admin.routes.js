const express = require('express');
const { requireAdmin } = require('../middleware/require-admin');
const { listAdminCameras, updateAlertPhone, listSmsLogs } = require('../controllers/admin.controller');

const router = express.Router();
router.use(requireAdmin);
router.get('/cameras', listAdminCameras);
router.patch('/cameras/:id/alert-phone', updateAlertPhone);
router.get('/sms-logs', listSmsLogs);

module.exports = router;
