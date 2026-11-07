// 지도에서 빨갛게 표시하는 화재 이벤트, 서버가 알려주는 alerting 값을 사용
// (확인하지 않았고 마지막 탐지가 30분 안인 fire), 값이 없는 개발용 예시 데이터는 확인 여부로 판단
function isAlertingFire(event) {
  return event.type === 'fire' && (event.alerting ?? event.status !== 'CONFIRMED')
}

// 알림 중인 화재 이벤트가 있는 카메라 ID 집합
export function activeFireCameraIds(events) {
  return new Set(events.filter(event => event.cameraId != null && isAlertingFire(event)).map(event => event.cameraId))
}

function isPopupDetection(event, now) {
  if (event.status === 'CONFIRMED' || event.acknowledgedAt) return false
  if (event.type === 'fire') return isAlertingFire(event)
  // Backend의 is_alerting은 fire 전용이므로 연기는 확인 여부와 마지막 탐지 시각으로 판단
  if (event.type !== 'smoke') return false
  const lastDetected = Date.parse(event.endedAt ?? event.updatedAt ?? event.detectedAt)
  return Number.isFinite(lastDetected) && lastDetected > now - 30 * 60 * 1000
}

// 첫 조회는 생략하고 카메라·유형별 기존 알림과 구분해 새 화재·연기를 표시
export function findNewDetectionEvents(previousIds, events, now = Date.now()) {
  if (!previousIds) return []
  const key = event => `${event.type}:${event.cameraId}`
  const alreadyAlerting = new Set(events.filter(event => previousIds.has(event.id) && event.cameraId != null && isPopupDetection(event, now)).map(key))
  return events.filter(event => !previousIds.has(event.id) && isPopupDetection(event, now) && !alreadyAlerting.has(key(event)))
}

// 팝업에 표시한 이벤트의 상태도 서버·즉시 확인 결과와 동기화
export function reconcileDetectionAlerts(alerts, events, fresh = [], now = Date.now()) {
  const current = new Map(events.map(event => [event.id, event]))
  return [...new Set([...fresh, ...alerts].map(event => event.id))]
    .map(id => current.get(id)).filter(event => event && isPopupDetection(event, now))
}

// 이벤트를 확인 완료로 바꿉니다. 화재 이벤트를 확인하면 같은 카메라의 알림 중인 화재 이벤트도 함께 바뀜(서버와 같은 규칙)
export function applyAcknowledged(events, ids) {
  const fireCameras = new Set(events.filter(event => ids.includes(event.id) && event.type === 'fire' && event.cameraId != null).map(event => event.cameraId))
  return events.map(event => {
    const sibling = event.type === 'fire' && fireCameras.has(event.cameraId) && isAlertingFire(event)
    return ids.includes(event.id) || sibling ? { ...event, status: 'CONFIRMED', alerting: false } : event
  })
}
