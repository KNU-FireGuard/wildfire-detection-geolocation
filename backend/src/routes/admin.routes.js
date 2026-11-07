const express = require('express');
const { requireAdmin } = require('../middleware/require-admin');
const { listAdminCameras, updateAlertPhone, listSmsLogs, deleteSmsLogs } = require('../controllers/admin.controller');
const { acknowledgeEvent } = require('../controllers/events.controller');

const router = express.Router();
// 이전 Frontend와 호환되는 공개 확인 주소
router.post('/events/:id/acknowledge', acknowledgeEvent);
router.use(requireAdmin);
router.get('/cameras', listAdminCameras);
router.patch('/cameras/:id/alert-phone', updateAlertPhone);
router.get('/sms-logs', listSmsLogs);
router.delete('/sms-logs', deleteSmsLogs);

module.exports = router;
