const pool = require('../config/db');

const EVENT_COLUMNS = `e.id, e.video_id, v.camera_id, e.class, e.started_at,
  e.ended_at, e.max_confidence, e.estimated_latitude, e.estimated_longitude,
  e.error_range_m, e.created_at, e.updated_at`;
const EVENT_FROM = 'FROM detection_events e JOIN videos v ON v.id = e.video_id';

function pagination(query) {
  const read = (key, fallback, min, max) => {
    const value = query[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const limit = read('limit', 50, 1, 100);
  const offset = read('offset', 0, 0, 2147483647);
  return limit === null || offset === null ? null : { limit, offset };
}

function list(sql) {
  return async (req, res) => {
    const page = pagination(req.query);
    if (!page) {
      return res.status(400).json({ error: 'limit은 1~100, offset은 0~2147483647의 정수여야 합니다.' });
    }
    const { rows } = await pool.query(sql, [page.limit, page.offset]);
    res.json({ items: rows, ...page });
  };
}

const listCameras = list(`SELECT id, name, latitude, longitude, created_at
  FROM cameras ORDER BY id ASC LIMIT $1 OFFSET $2`);
// 서버 내부 저장 경로는 공개하지 않습니다. 영상 재생 API는 별도로 구현합니다.
const listVideos = list(`SELECT id, camera_id, original_filename, created_at
  FROM videos ORDER BY id DESC LIMIT $1 OFFSET $2`);
const listEvents = list(`SELECT ${EVENT_COLUMNS} ${EVENT_FROM}
  ORDER BY e.started_at DESC, e.id DESC LIMIT $1 OFFSET $2`);

async function getEvent(req, res) {
  const raw = req.params.id;
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(id) || id < 1 || id > 2147483647) {
    return res.status(400).json({ error: '이벤트 ID는 1~2147483647의 정수여야 합니다.' });
  }
  const { rows } = await pool.query(`SELECT ${EVENT_COLUMNS} ${EVENT_FROM} WHERE e.id = $1`, [id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: '탐지 이벤트가 없습니다.' });
  }
  res.json({ item: rows[0] });
}

module.exports = { listCameras, listVideos, listEvents, getEvent };
