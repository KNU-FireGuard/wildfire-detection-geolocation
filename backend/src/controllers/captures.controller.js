const pool = require('../config/db');
const runs = require('../services/run-manager');
const { createCaptureStore } = require('../services/event-captures');
const { pagination } = require('./catalog.controller');
const store = createCaptureStore({ pool });
const validId = value => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647;
const metadata = row => ({
  id: row.id, event_id: row.event_id, video_time_ms: Number(row.video_time_ms),
  created_at: row.created_at, image_url: `/api/event-captures/${row.id}/image`,
});

async function receiveCapture(req, res) {
  const runId = Number(req.params.run_id);
  const rawTime = req.get('X-Video-Time-Ms') || '';
  const time = Number(rawTime);
  if (!Number.isSafeInteger(runId) || runId < 1 || !['fire', 'smoke'].includes(req.params.class_name)
    || !/^\d+$/.test(rawTime) || !Number.isSafeInteger(time)) {
    return res.status(400).json({ error: '실행 ID·탐지 유형·영상 시각이 올바르지 않습니다.' });
  }
  const run = runs.getRun(runId);
  if (!run || !run.video_id) return res.status(404).json({ error: '테스트 실행이 없습니다.' });
  if (!['ready', 'running'].includes(run.status)) return res.status(409).json({ error: '종료된 실행입니다.' });
  const eventId = run.eventIdsByClass.get(req.params.class_name);
  if (!eventId) return res.status(409).json({ error: '확정 탐지 이벤트가 없습니다.' });
  const jpeg = req.body;
  if (!req.is('image/jpeg') || !Buffer.isBuffer(jpeg) || jpeg.length < 4
    || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) {
    return res.status(400).json({ error: 'JPEG 캡처가 필요합니다.' });
  }
  const saved = await store.save(eventId, time, jpeg);
  return res.status(saved ? 201 : 200).json({ item: saved ? metadata(saved) : null });
}

async function listCaptures(req, res) {
  const page = pagination(req.query);
  if (!validId(req.params.id) || !page) return res.status(400).json({ error: '이벤트 ID 또는 페이지가 올바르지 않습니다.' });
  const before = req.query.before_time_ms;
  if (before !== undefined && (typeof before !== 'string' || !/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)))) {
    return res.status(400).json({ error: '캡처 조회 시각이 올바르지 않습니다.' });
  }
  const params = [Number(req.params.id), page.limit, page.offset];
  if (before !== undefined) params.push(Number(before));
  const { rows } = await pool.query(`SELECT id, event_id, video_time_ms, created_at FROM event_captures
    WHERE event_id = $1 ${before === undefined ? '' : 'AND video_time_ms < $4'}
    ORDER BY video_time_ms DESC, id DESC LIMIT $2 OFFSET $3`, params);
  res.json({ items: rows.map(metadata), ...page });
}

async function getCaptureImage(req, res) {
  if (!validId(req.params.id)) return res.status(400).json({ error: '캡처 ID가 올바르지 않습니다.' });
  const { rows } = await pool.query('SELECT jpeg FROM event_captures WHERE id = $1', [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: '캡처가 없습니다.' });
  res.set({ 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
  res.send(rows[0].jpeg);
}

module.exports = { receiveCapture, listCaptures, getCaptureImage };
