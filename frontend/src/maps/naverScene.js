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
      const marker = new maps.Marker({
        map, position: position(camera), title: camera.name,
        zIndex: selected ? 20 : 10,
        icon: {
          content: `<div style="display:grid;place-items:center;width:38px;height:38px;border:2px solid white;border-radius:50% 50% 50% 4px;transform:rotate(-45deg);background:${selected ? '#195baf' : '#337fd4'};box-shadow:0 2px 6px #0006"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(45deg)"><path d="M4 8.5h10a2 2 0 0 1 2 2v6H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Z"/><path d="m16 11 6-3v9l-6-3"/><path d="M6 6h5"/></svg></div>`,
          anchor: new maps.Point(19, 38),
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
