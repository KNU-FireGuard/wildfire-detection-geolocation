const { validateDetection } = require('../validators/detections.validator');
const pool = require('../config/db');
const testRuns = require('../services/run-manager');
const fireAlert = require('../services/fire-alert');
const { WINDOW, alertingSql, lastDetectedSql } = require('../services/fire-state');

// 카메라에 확인하지 않았고 마지막 탐지가 30분 안인 화재 이벤트가 있는지(지도에서 빨간 상태인지)
async function hasAlertingFire(cameraId) {
  const { rows } = await pool.query(`
    SELECT 1 FROM detection_events e LEFT JOIN videos v ON v.id = e.video_id
    WHERE COALESCE(e.camera_id, v.camera_id) = $1 AND ${alertingSql('e')}
    LIMIT 1
  `, [cameraId]);
  return rows.length > 0;
}

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
  // 마지막 탐지 후 30분이 지난 이벤트는 갱신하지 않고 새 이벤트로 만듭니다.
  let updated = false;
  if (eventId) {
    const { rows } = await pool.query(`
      UPDATE detection_events
      SET max_confidence = GREATEST(max_confidence, $2),
          estimated_latitude = COALESCE($3, estimated_latitude),
          estimated_longitude = COALESCE($4, estimated_longitude),
          error_range_m = CASE WHEN $3 IS NULL THEN error_range_m ELSE $5 END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND ${lastDetectedSql()} > CURRENT_TIMESTAMP - ${WINDOW}
      RETURNING id
    `, [eventId, confidence, ...coordinates]);
    updated = rows.length > 0;
  }
  if (!updated) {
    // 문자는 카메라가 파랑에서 빨강으로 바뀔 때만 보냄, 같은 카메라에 알림 중인 화재가 이미 있으면 보내지 않음
    const alreadyAlerting = className === 'fire' && await hasAlertingFire(run.camera_id);
    const { rows } = await pool.query(`
      INSERT INTO detection_events
        (video_id, camera_id, class, started_at, ended_at, max_confidence,
         estimated_latitude, estimated_longitude, error_range_m)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, NULL, $4, $5, $6, $7)
      RETURNING id
    `, [run.video_id, run.video_id ? null : run.camera_id, className, confidence, ...coordinates]);
    run.eventIdsByClass.set(className, rows[0].id);
    // fire만 문자 대상, smoke는 화면 표시만. 번호는 이벤트가 아닌 실행의 카메라 ID로 조회
    if (className === 'fire' && !alreadyAlerting) {
      void Promise.resolve()
        .then(() => fireAlert.notifyFireDetected({ cameraId: run.camera_id, eventId: rows[0].id, confidence }))
        .catch(error => console.error('화재 알림 요청 오류:', error.message));
    }
  }

  return res.status(202).json({ accepted: true });
}

module.exports = { receiveDetection };
