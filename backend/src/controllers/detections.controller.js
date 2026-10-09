const { validateDetection } = require('../validators/detections.validator');
const pool = require('../config/db');
const testRuns = require('../services/run-manager');

async function receiveDetection(req, res) {
  const detection = req.body;
  const errors = validateDetection(detection);
  if (errors.length > 0) {
    return res.status(400).json({
      error: '입력값이 올바르지 않습니다.',
      details: errors,
    });
  }

  const run = testRuns.getRun(detection.run_id);
  if (!run) return res.status(404).json({ error: '테스트 실행이 없습니다.' });
  if (run.camera_id !== detection.camera_id) {
    return res.status(400).json({ error: 'camera_id가 테스트 실행과 일치하지 않습니다.' });
  }
  if (!['ready', 'running'].includes(run.status)) {
    return res.status(409).json({ error: '탐지 결과를 받을 수 없는 실행 상태입니다.' });
  }

  const className = detection.detection.class;
  const confidence = detection.detection.confidence;
  const location = detection.location_estimation;
  const coordinates = location
    ? [location.latitude, location.longitude, location.error_range_m]
    : [null, null, null];
  const eventId = run.eventIdsByClass.get(className);
  if (eventId) {
    await pool.query(`
      UPDATE detection_events
      SET max_confidence = GREATEST(max_confidence, $2),
          estimated_latitude = COALESCE($3, estimated_latitude),
          estimated_longitude = COALESCE($4, estimated_longitude),
          error_range_m = CASE WHEN $3 IS NULL THEN error_range_m ELSE $5 END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [eventId, confidence, ...coordinates]);
  } else {
    const { rows } = await pool.query(`
      INSERT INTO detection_events
        (video_id, class, started_at, ended_at, max_confidence,
         estimated_latitude, estimated_longitude, error_range_m)
      VALUES ($1, $2, CURRENT_TIMESTAMP, NULL, $3, $4, $5, $6)
      RETURNING id
    `, [run.video_id, className, confidence, ...coordinates]);
    run.eventIdsByClass.set(className, rows[0].id);
  }

  return res.status(202).json({ accepted: true });
}

module.exports = { receiveDetection };
