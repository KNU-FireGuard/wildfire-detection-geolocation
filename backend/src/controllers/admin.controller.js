const pool = require('../config/db');
const { pagination } = require('./catalog.controller');
const { DOMESTIC_MOBILE } = require('../services/notifier');

const PAGE_ERROR = 'limit은 1~100, offset은 0~2147483647의 정수여야 합니다.';

async function listAdminCameras(req, res) {
  const page = pagination(req.query);
  if (!page) return res.status(400).json({ error: PAGE_ERROR });
  const { rows } = await pool.query(`SELECT id, name, source_type, alert_phone
    FROM cameras ORDER BY id ASC LIMIT $1 OFFSET $2`, [page.limit, page.offset]);
  return res.json({ items: rows, ...page });
}

async function updateAlertPhone(req, res) {
  const raw = req.params.id;
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(id) || id < 1 || id > 2147483647) {
    return res.status(400).json({ error: '카메라 ID는 1~2147483647의 정수여야 합니다.' });
  }
  const phone = req.body?.alert_phone;
  if (phone !== null && !(typeof phone === 'string' && DOMESTIC_MOBILE.test(phone))) {
    return res.status(400).json({ error: 'alert_phone은 하이픈 없는 010 휴대전화 번호 11자리 또는 null이어야 합니다.' });
  }
  const { rows } = await pool.query(
    'UPDATE cameras SET alert_phone = $2 WHERE id = $1 RETURNING id, name, alert_phone',
    [id, phone],
  );
  if (rows.length === 0) return res.status(404).json({ error: '카메라가 없습니다.' });
  return res.json(rows[0]);
}

async function listSmsLogs(req, res) {
  const page = pagination(req.query);
  if (!page) return res.status(400).json({ error: PAGE_ERROR });
  const { rows } = await pool.query(`SELECT l.id, l.camera_id, c.name AS camera_name, l.event_id,
      l.phone_number, l.message, l.status, l.provider, l.error, l.created_at
    FROM sms_logs l LEFT JOIN cameras c ON c.id = l.camera_id
    ORDER BY l.created_at DESC, l.id DESC LIMIT $1 OFFSET $2`, [page.limit, page.offset]);
  return res.json({ items: rows, ...page });
}

module.exports = { listAdminCameras, updateAlertPhone, listSmsLogs };
