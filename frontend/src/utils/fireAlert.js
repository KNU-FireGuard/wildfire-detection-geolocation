// 운영자가 아직 확인하지 않은 화재(fire) 이벤트만 빨간 표시와 알림 대상으로 봅니다.
function isUnconfirmedFire(event) {
  return event.type === 'fire' && event.status !== 'CONFIRMED'
}

// 확인하지 않은 화재 이벤트가 있는 카메라 ID 집합
export function activeFireCameraIds(events) {
  return new Set(events.filter(event => event.cameraId != null && isUnconfirmedFire(event)).map(event => event.cameraId))
}

// 이전 조회에 없던 확인 전 화재 이벤트, 첫 조회(previousIds가 null)는 알리지 않음
export function findNewFireEvents(previousIds, events) {
  if (!previousIds) return []
  return events.filter(event => !previousIds.has(event.id) && isUnconfirmedFire(event))
}
