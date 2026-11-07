export function hasCoordinates(location) {
  return Number.isFinite(location?.latitude) && Math.abs(location.latitude) <= 90
    && Number.isFinite(location?.longitude) && Math.abs(location.longitude) <= 180
}

export function errorRangeDisplay(location) {
  const radius = location?.errorRadiusM
  if (!Number.isFinite(radius) || radius < 0) return { mode: 'unknown', label: '오차 범위 미산출' }
  if (radius >= 1000) return { mode: 'low-confidence', label: `위치 신뢰 낮음 · 오차 반경 ${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(radius / 1000)} km` }
  return { mode: 'radius', label: `오차 반경 ${new Intl.NumberFormat('ko-KR').format(radius)} m` }
}

export function isVisibleEstimatedEvent(event) {
  return event?.status !== 'CONFIRMED' && hasCoordinates(event?.estimatedLocation)
}

export function focusLocationsForRequest(request, cameras, events) {
  if (!request) return []
  if (request.kind === 'camera') {
    const camera = cameras.find(item => item.id === request.id)
    const latest = events.filter(event => event.cameraId === request.id)
      .reduce((current, event) => !current || Date.parse(event.detectedAt) > Date.parse(current.detectedAt) ? event : current, null)
    return [camera, isVisibleEstimatedEvent(latest) ? latest.estimatedLocation : null].filter(hasCoordinates)
  }
  if (request.kind === 'event') {
    const event = events.find(item => item.id === request.id)
    const camera = cameras.find(item => item.id === event?.cameraId)
    return [camera, isVisibleEstimatedEvent(event) ? event.estimatedLocation : null].filter(hasCoordinates)
  }
  return []
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

// SDK 객체는 Vue의 reactive/ref에 넣지 않고 지도 수명에 맞춰 직접 관리합니다.
export function createNaverScene(maps, map, onCameraSelect) {
  let overlays = []
  let listeners = []
  const position = location => new maps.LatLng(location.latitude, location.longitude)
  const cameraIcon = (selected, onFire) => {
    const size = Math.round(Math.max(24, Math.min(48, 24 + 4 * (map.getZoom() - 8))))
    const symbolSize = Math.round(size * 21 / 38)
    return {
      content: `<div style="box-sizing:border-box;display:grid;place-items:center;width:${size}px;height:${size}px;border:2px solid #ffffffee;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);background:${onFire ? 'linear-gradient(135deg,#ff7a68,#e0402e)' : selected ? 'linear-gradient(135deg,#2f86ec,#1a57b0)' : 'linear-gradient(135deg,#4aa3ff,#2a78d8)'};box-shadow:0 0 0 ${onFire || selected ? 6 : 3}px ${onFire ? 'rgba(255,106,87,.4)' : `rgba(85,169,255,${selected ? '.32' : '.18'})`},0 8px 16px #0009"><svg width="${symbolSize}" height="${symbolSize}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(45deg)"><path d="M4 8.5h10a2 2 0 0 1 2 2v6H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z"/><path d="m16 11 6-3v9l-6-3"/><path d="M6 6h5"/></svg></div>`,
      anchor: new maps.Point(size / 2, size),
    }
  }
  const fireCenterIcon = () => ({
    content: '<div style="box-sizing:border-box;width:14px;height:14px;border:2px solid white;border-radius:50%;background:#e0402e;box-shadow:0 0 0 3px rgba(255,106,87,.25)"></div>',
    anchor: new maps.Point(7, 7),
  })
  function clear() {
    listeners.forEach(listener => maps.Event.removeListener(listener))
    overlays.forEach(overlay => overlay.setMap(null))
    listeners = []
    overlays = []
  }
  function render({ cameras, events = [], selectedCamera, selectedEvent, fireCameraIds = new Set() }) {
    clear()
    for (const camera of cameras.filter(hasCoordinates)) {
      const selected = camera.id === selectedCamera?.id
      const onFire = fireCameraIds.has(camera.id)
      const marker = new maps.Marker({
        map, position: position(camera), title: camera.name,
        zIndex: onFire ? 25 : selected ? 20 : 10,
        icon: cameraIcon(selected, onFire),
      })
      overlays.push(marker)
      listeners.push(maps.Event.addListener(marker, 'click', () => onCameraSelect(camera)))
      listeners.push(maps.Event.addListener(map, 'zoom_changed', () => marker.setIcon(cameraIcon(selected, onFire))))
    }
    const visibleEvents = (events.length ? events : selectedEvent ? [selectedEvent] : []).filter(isVisibleEstimatedEvent)
    for (const event of visibleEvents) {
      const fire = event.estimatedLocation
      const range = errorRangeDisplay(fire)
      // 오차가 커도 픽셀 마커로 대체하지 않고 SDK의 미터 반경 원으로 지도 축척에 맞춤
      if (range.mode !== 'unknown') {
        overlays.push(new maps.Circle({
          map, center: position(fire), radius: fire.errorRadiusM,
          strokeColor: '#e0402e', strokeOpacity: 1, strokeWeight: 2,
          fillColor: '#e0402e', fillOpacity: 0.08, clickable: false, zIndex: 15,
        }))
      }
      const fireMarker = new maps.Marker({
        map, position: position(fire), title: `추정 산불 위치 · ${range.label}`, zIndex: selectedEvent && event.id === selectedEvent.id ? 31 : 30,
        icon: fireCenterIcon(),
      })
      overlays.push(fireMarker)
    }
    const selectedFire = selectedEvent && visibleEvents.find(event => event.id === selectedEvent.id)?.estimatedLocation
    if (selectedFire && hasCoordinates(selectedCamera)) {
      overlays.push(new maps.Polyline({ map, path: [position(selectedCamera), position(selectedFire)], strokeColor: '#7cc0ff', strokeWeight: 3, strokeStyle: 'shortdash' }))
    }
  }
  function focus(locations) {
    const valid = locations.filter(hasCoordinates)
    if (valid.length === 1) { map.setCenter(position(valid[0])); map.setZoom(14) }
    else if (valid.length > 1) map.fitBounds(valid.map(position), { top: 80, right: 80, bottom: 60, left: 60, maxZoom: 16 })
  }
  return { render, focus, clear }
}
