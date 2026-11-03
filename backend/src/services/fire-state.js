// 화재 이벤트가 "알림 중"인 시간, 마지막 탐지 후 이 시간이 지나면 확인하지 않아도 알림이 끝남
const FIRE_ACTIVE_MINUTES = 30;
const WINDOW = `INTERVAL '${FIRE_ACTIVE_MINUTES} minutes'`;

// 마지막 탐지 시각: 종료된 이벤트는 ended_at, 진행 중인 이벤트는 갱신 시각
function lastDetectedSql(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `COALESCE(${prefix}ended_at, ${prefix}updated_at)`;
}

// 아직 확인하지 않았고 마지막 탐지가 30분 안인 화재 이벤트 조건
function alertingSql(alias = 'e') {
  return `(${alias}.class = 'fire' AND ${alias}.acknowledged_at IS NULL AND ${lastDetectedSql(alias)} > CURRENT_TIMESTAMP - ${WINDOW})`;
}

module.exports = { FIRE_ACTIVE_MINUTES, WINDOW, lastDetectedSql, alertingSql };
