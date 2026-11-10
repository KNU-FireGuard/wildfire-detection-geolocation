const express = require('express');
const { requireAdmin } = require('../middleware/require-admin');
const { listAdminCameras, updateAlertPhone, listSmsLogs, deleteSmsLogs } = require('../controllers/admin.controller');
const { acknowledgeEvent } = require('../controllers/events.controller');
const { monitor } = require('../services/live-cctv-runtime');

const router = express.Router();
// 이전 Frontend와 호환되는 공개 확인 주소
router.post('/events/:id/acknowledge', acknowledgeEvent);
router.use(requireAdmin);
router.get('/live-monitor', (req, res) => res.json(monitor.status()));
router.put('/live-monitor', async (req, res, next) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled는 boolean이어야 합니다.' });
  }
  try {
    if (req.body.enabled) await monitor.start();
    else await monitor.stop();
    return res.json(monitor.status());
  } catch (error) { return next(error); }
});
router.get('/cameras', listAdminCameras);
router.patch('/cameras/:id/alert-phone', updateAlertPhone);
router.get('/sms-logs', listSmsLogs);
router.delete('/sms-logs', deleteSmsLogs);

module.exports = router;
