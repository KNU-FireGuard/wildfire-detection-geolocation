const pool = require('../config/db');
const { EVENT_COLUMNS, EVENT_FROM } = require('./catalog.controller');
const { alertingSql } = require('../services/fire-state');

// 확인 시각은 최초 한 번만 기록, 마지막 탐지 시각(updated_at)은 유지
async function acknowledgeEvent(req, res) {
  const raw = req.params.id;
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(id) || id < 1 || id > 2147483647) {
    return res.status(400).json({ error: '이벤트 ID는 1~2147483647의 정수여야 합니다.' });
  }
  await pool.query(`
    UPDATE detection_events SET acknowledged_at = CURRENT_TIMESTAMP
    WHERE acknowledged_at IS NULL AND (
      id = $1
      OR (
        ${alertingSql('detection_events')}
        AND (SELECT class FROM detection_events WHERE id = $1) = 'fire'
        AND COALESCE(camera_id, (SELECT camera_id FROM videos WHERE videos.id = detection_events.video_id)) = (
          SELECT COALESCE(t.camera_id, v.camera_id) FROM detection_events t LEFT JOIN videos v ON v.id = t.video_id WHERE t.id = $1
        )
      )
    )
  `, [id]);
  const { rows } = await pool.query(`SELECT ${EVENT_COLUMNS} ${EVENT_FROM} WHERE e.id = $1`, [id]);
  if (rows.length === 0) return res.status(404).json({ error: '탐지 이벤트가 없습니다.' });
  return res.json({ item: rows[0] });
}

module.exports = { acknowledgeEvent };
