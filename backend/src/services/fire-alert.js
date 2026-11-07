const defaultPool = require('../config/db');
const { createNotifier } = require('./notifier');

const SMS_MAX_BYTES = 90;
const PREFIX = '[FireGuard] 화재 탐지: ';

// 한글 2바이트·그 외 1바이트로 계산, 90바이트를 넘으면 LMS로 전환되어 비용이 늘어남
function byteLength(text) {
  return [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 2 : 1), 0);
}

function buildMessage(cameraName) {
  let name = '';
  let used = byteLength(PREFIX);
  for (const char of cameraName) {
    used += byteLength(char);
    if (used > SMS_MAX_BYTES) break;
    name += char;
  }
  return PREFIX + name;
}

// 화재 탐지 시 카메라에 설정된 번호로 문자를 보내고 결과를 sms_logs에 기록합니다.
// 호출자의 탐지 저장을 막지 않도록 모든 오류는 내부에서 처리합니다.
function createFireAlert({ pool = defaultPool, notifier = createNotifier() } = {}) {
  async function writeLog(cameraId, eventId, phone, message, status, error) {
    const sql = `
      INSERT INTO sms_logs (camera_id, event_id, phone_number, message, status, provider, error)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    const values = [cameraId, eventId, phone, message, status, notifier.name, error];
    try { await pool.query(sql, values); }
    catch (failure) {
      // Event deletion may finish while the provider request is pending. Keep the send log.
      if (failure.code !== '23503' || failure.constraint !== 'sms_logs_event_id_fkey') throw failure;
      await pool.query(sql, [cameraId, null, phone, message, status, notifier.name, error]);
    }
  }

  async function notifyFire({ cameraId, eventId, confidence }) {
    try {
      const { rows } = await pool.query('SELECT name, alert_phone FROM cameras WHERE id = $1', [cameraId]);
      if (rows.length === 0) return;
      const { name, alert_phone: phone } = rows[0];
      const message = buildMessage(name);
      if (!phone) {
        await writeLog(cameraId, eventId, null, message, 'skipped', null);
        return;
      }
      try {
        await notifier.send(phone, message);
      } catch (error) {
        await writeLog(cameraId, eventId, phone, message, 'failed', error.message);
        return;
      }
      await writeLog(cameraId, eventId, phone, message, 'sent', null);
    } catch (error) {
      console.error('화재 알림 처리 오류:', error.message);
    }
  }

  return { notifyFire };
}

let defaultAlert;
// 기본 인스턴스는 첫 호출 시 만들어 SMS 설정 오류가 서버 시작을 막지 않게 합니다.
async function notifyFireDetected(alert) {
  try {
    defaultAlert ||= createFireAlert();
  } catch (error) {
    console.error('화재 알림 설정 오류:', error.message);
    return;
  }
  await defaultAlert.notifyFire(alert);
}

module.exports = { createFireAlert, notifyFireDetected, buildMessage };
