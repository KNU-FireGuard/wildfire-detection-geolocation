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
export function findNewFireEvents(previousIds, events) {
  if (!previousIds) return []
  return events.filter(event => !previousIds.has(event.id) && isAlertingFire(event))
}
