// 화재(fire) 이벤트를 "진행 중"으로 보는 시간, 이 안에 탐지된 이벤트만 빨간 표시와 알림 대상
export const ACTIVE_FIRE_WINDOW_MS = 30 * 60 * 1000

function isActiveFire(event, now) {
  if (event.type !== 'fire' || event.status === 'CONFIRMED') return false
  const detected = Date.parse(event.detectedAt)
  return Number.isFinite(detected) && now - detected >= 0 && now - detected <= ACTIVE_FIRE_WINDOW_MS
}

// 진행 중인 화재가 있는 카메라 ID 집합
export function activeFireCameraIds(events, now) {
  return new Set(events.filter(event => event.cameraId != null && isActiveFire(event, now)).map(event => event.cameraId))
}

// 이전 조회에 없던 진행 중 화재 이벤트, 첫 조회(previousIds가 null)는 알리지 않음
export function findNewFireEvents(previousIds, events, now) {
  if (!previousIds) return []
  return events.filter(event => !previousIds.has(event.id) && isActiveFire(event, now))
}
