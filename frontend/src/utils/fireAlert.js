// 지도에서 빨갛게 표시하고 알림을 띄우는 화재 이벤트, 서버가 알려주는 alerting 값을 사용
// (확인하지 않았고 마지막 탐지가 30분 안인 fire), 값이 없는 개발용 예시 데이터는 확인 여부로 판단
function isAlertingFire(event) {
  return event.type === 'fire' && (event.alerting ?? event.status !== 'CONFIRMED')
}

// 알림 중인 화재 이벤트가 있는 카메라 ID 집합
export function activeFireCameraIds(events) {
  return new Set(events.filter(event => event.cameraId != null && isAlertingFire(event)).map(event => event.cameraId))
}

// 이전 조회에 없던 알림 중 화재 이벤트, 첫 조회(previousIds가 null)는 알리지 않음
// 이미 알림 중인 화재가 있는 카메라에서 재시작 등으로 생긴 새 이벤트는 같은 불이라 다시 알리지 않음
export function findNewFireEvents(previousIds, events) {
  if (!previousIds) return []
  const alreadyAlerting = new Set(events.filter(event => previousIds.has(event.id) && event.cameraId != null && isAlertingFire(event)).map(event => event.cameraId))
  return events.filter(event => !previousIds.has(event.id) && isAlertingFire(event) && !alreadyAlerting.has(event.cameraId))
}

// 이벤트를 확인 완료로 바꿉니다. 화재 이벤트를 확인하면 같은 카메라의 알림 중인 화재 이벤트도 함께 바뀜(서버와 같은 규칙)
export function applyAcknowledged(events, ids) {
  const fireCameras = new Set(events.filter(event => ids.includes(event.id) && event.type === 'fire' && event.cameraId != null).map(event => event.cameraId))
  return events.map(event => {
    const sibling = event.type === 'fire' && fireCameras.has(event.cameraId) && isAlertingFire(event)
    return ids.includes(event.id) || sibling ? { ...event, status: 'CONFIRMED', alerting: false } : event
  })
}
