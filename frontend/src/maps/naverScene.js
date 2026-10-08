export function hasCoordinates(location) {
  return Number.isFinite(location?.latitude) && Math.abs(location.latitude) <= 90
    && Number.isFinite(location?.longitude) && Math.abs(location.longitude) <= 180
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

// SDK 객체는 Vue의 reactive/ref에 넣지 않고 지도 수명에 맞춰 직접 관리합니다.
export function createNaverScene(maps, map, onCameraSelect) {
  let overlays = []
  let listeners = []
  const position = location => new maps.LatLng(location.latitude, location.longitude)
  function clear() {
    listeners.forEach(listener => maps.Event.removeListener(listener))
    overlays.forEach(overlay => overlay.setMap(null))
    listeners = []
    overlays = []
  }
  function render({ cameras, selectedCamera, selectedEvent }) {
    clear()
    for (const camera of cameras.filter(hasCoordinates)) {
      const selected = camera.id === selectedCamera?.id
      const label = escapeHtml(camera.name ?? `카메라 ${camera.id}`)
      const marker = new maps.Marker({
        map, position: position(camera), title: camera.name,
        zIndex: selected ? 20 : 10,
        icon: {
          content: `<div style="border:2px solid white;border-radius:8px;padding:6px 9px;background:${selected ? '#195baf' : '#337fd4'};color:white;font:12px sans-serif;white-space:nowrap;box-shadow:0 2px 6px #0006">CCTV · ${label}</div>`,
          anchor: new maps.Point(16, 16),
        },
      })
      overlays.push(marker)
      listeners.push(maps.Event.addListener(marker, 'click', () => onCameraSelect(camera)))
    }
    const fire = selectedEvent?.estimatedLocation
    if (hasCoordinates(fire)) {
      overlays.push(new maps.Marker({
        map, position: position(fire), title: '추정 산불 위치', zIndex: 30,
        icon: { content: '<div style="border:2px solid white;border-radius:8px;padding:7px 10px;background:#df4036;color:white;font:12px sans-serif;white-space:nowrap">추정 산불 위치</div>', anchor: new maps.Point(16, 16) },
      }))
      if (hasCoordinates(selectedCamera)) {
        overlays.push(new maps.Polyline({ map, path: [position(selectedCamera), position(fire)], strokeColor: '#74bdff', strokeWeight: 3, strokeStyle: 'shortdash' }))
      }
    }
  }
  function focus(locations) {
    const valid = locations.filter(hasCoordinates)
    if (valid.length === 1) { map.setCenter(position(valid[0])); map.setZoom(14) }
    else if (valid.length > 1) map.fitBounds(valid.map(position), { top: 80, right: 80, bottom: 60, left: 60, maxZoom: 16 })
  }
  return { render, focus, clear }
}
