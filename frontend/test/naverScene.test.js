import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNaverScene, errorRangeDisplay, focusLocationsForRequest, hasCoordinates, isVisibleEstimatedEvent } from '../src/maps/naverScene.js'
import { loadNaverMaps } from '../src/maps/naverLoader.js'

function fixture() {
  const overlays = [], listeners = [], removed = []
  class Overlay {
    constructor(options) { this.options = options; overlays.push(this) }
    setMap(map) { this.map = map }
    setIcon(icon) { this.options.icon = icon }
  }
  const maps = {
    LatLng: class { constructor(latitude, longitude) { Object.assign(this, { latitude, longitude }) } },
    Point: class { constructor(x, y) { Object.assign(this, { x, y }) } }, Marker: Overlay, Polyline: Overlay, Circle: Overlay,
    Event: { addListener: (target, event, handler) => { const listener = { target, event, handler }; listeners.push(listener); return listener }, removeListener: listener => removed.push(listener) },
  }
  const map = { zoom: 7, getZoom: () => map.zoom, setCenter: position => { map.center = position }, setZoom: zoom => { map.zoom = zoom }, fitBounds: bounds => { map.bounds = bounds } }
  return { maps, map, overlays, listeners, removed }
}
const camera = { id: 1, name: '<img onerror="bad">', latitude: 36, longitude: 128 }
const fire = { latitude: 36.1, longitude: 128.1 }

test('유효하지 않은 좌표와 누락된 지도 키를 거부한다', async () => {
  for (const value of [null, {}, { latitude: null, longitude: 0 }, { latitude: '36', longitude: 128 }, { latitude: 91, longitude: 128 }, { latitude: 36, longitude: 181 }]) assert.equal(hasCoordinates(value), false)
  assert.equal(hasCoordinates({ latitude: 0, longitude: 0 }), true)
  await assert.rejects(loadNaverMaps(''), /아직 설정/)
})

test('CCTV 클릭, 산불 좌표, 연결선과 마커 라벨 이스케이프를 검증한다', () => {
  const f = fixture()
  let selected
  const scene = createNaverScene(f.maps, f.map, value => { selected = value })
  scene.render({ cameras: [camera, { id: 2 }], selectedCamera: camera, selectedEvent: { estimatedLocation: fire } })
  assert.equal(f.overlays.length, 3)
  assert.equal(f.overlays[0].options.position.latitude, 36)
  assert.equal(f.overlays[1].options.position.longitude, 128.1)
  assert.equal(f.overlays[2].options.path.length, 2)
  assert.ok(!f.overlays[0].options.icon.content.includes('<img'))
  f.listeners[0].handler()
  assert.equal(selected, camera)
})

test('오차 미산출 위치는 범위를 지어내지 않고 작은 중심점으로 표시한다', () => {
  const f = fixture()
  const scene = createNaverScene(f.maps, f.map, () => {})
  scene.render({ cameras: [], selectedEvent: { estimatedLocation: fire } })
  const marker = f.overlays[0].options
  assert.equal(marker.title, '추정 산불 위치 · 오차 범위 미산출')
  assert.match(marker.icon.content, /border-radius:50%/)
  assert.match(marker.icon.content, /background:#e0402e/)
  assert.doesNotMatch(marker.icon.content, />추정 산불 위치</)
  assert.equal(marker.icon.anchor.x, marker.icon.anchor.y)
  assert.match(marker.icon.content, /width:14px;height:14px/)
  assert.equal(f.overlays.length, 1)
})

test('오차 반경에 따른 위치 표시 등급은 200m와 1km 경계를 구분한다', () => {
  assert.deepEqual(errorRangeDisplay(fire), { mode: 'unknown', label: '오차 범위 미산출' })
  for (const radius of [0, 110, 200]) assert.match(errorRangeDisplay({ errorRadiusM: radius }).label, /위치 신뢰도 높음/)
  for (const radius of [201, 999]) assert.match(errorRangeDisplay({ errorRadiusM: radius }).label, /위치 신뢰도 중간/)
  for (const radius of [1000, 1900, 4100]) {
    const range = errorRangeDisplay({ errorRadiusM: radius })
    assert.match(range.label, /위치 신뢰도 낮음 · 실제 오차 반경/)
    assert.equal(range.radiusM, 500)
  }
})

test('1km 미만은 미터 반경 원을 그리고 줌을 바꿔도 실제 반경을 유지한다', () => {
  const f = fixture()
  const scene = createNaverScene(f.maps, f.map, () => {})
  scene.render({ cameras: [], selectedEvent: { estimatedLocation: { ...fire, errorRadiusM: 150 } } })
  assert.equal(f.overlays.length, 2)
  assert.equal(f.overlays[0].options.radius, 150)
  assert.deepEqual([f.overlays[0].options.center.latitude, f.overlays[0].options.center.longitude], [36.1, 128.1])
  assert.equal(f.overlays[0].options.fillOpacity, 0.08)
  assert.equal(f.overlays[0].options.strokeOpacity, 1)
  assert.equal(f.overlays[0].options.clickable, false)
  assert.equal(f.overlays[1].options.icon.anchor.x, 7)
  assert.equal(f.listeners.filter(listener => listener.event === 'zoom_changed').length, 0)
  scene.render({ cameras: [], selectedEvent: { estimatedLocation: fire } })
  assert.equal(f.overlays[0].map, null)
  assert.equal(f.overlays[1].map, null)
})

test('1km 이상은 원본 오차값을 보존하면서 500m 점선 참고 원으로 표시한다', () => {
  for (const radius of [4360, 999, 1000, 1910, 4100, 0]) {
    const f = fixture()
    const scene = createNaverScene(f.maps, f.map, () => {})
    const location = { ...fire, errorRadiusM: radius }
    scene.render({ cameras: [], selectedEvent: { estimatedLocation: location } })
    assert.equal(f.overlays.length, 2)
    assert.equal(f.overlays[0].options.map, f.map)
    assert.equal(f.overlays[0].options.radius, radius >= 1000 ? 500 : radius)
    assert.equal(f.overlays[0].options.strokeStyle, radius >= 1000 ? 'shortdash' : 'solid')
    assert.equal(f.overlays[0].options.fillOpacity, radius >= 1000 ? 0.03 : 0.08)
    assert.equal(f.overlays[0].options.strokeOpacity, 1)
    assert.match(f.overlays[1].options.icon.content, /width:14px;height:14px/)
    assert.ok(f.overlays[1].options.title.includes(errorRangeDisplay(location).label))
    assert.equal(location.errorRadiusM, radius)
    scene.clear()
    assert.ok(f.overlays.every(overlay => overlay.map === null))
  }
})

test('미확인 이벤트 위치는 선택 없이 모두 표시하고 확인하면 해당 원을 제거한다', () => {
  const f = fixture()
  const scene = createNaverScene(f.maps, f.map, () => {})
  const first = { id: 1, status: 'UNCONFIRMED', estimatedLocation: fire }
  const second = { id: 2, status: 'UNCONFIRMED', estimatedLocation: { latitude: 37, longitude: 129, errorRadiusM: 150 } }
  const confirmed = { id: 3, status: 'CONFIRMED', estimatedLocation: { latitude: 38, longitude: 130 } }
  assert.equal(isVisibleEstimatedEvent(first), true)
  assert.equal(isVisibleEstimatedEvent(confirmed), false)
  scene.render({ cameras: [], events: [first, second, confirmed] })
  assert.equal(f.overlays.length, 3)
  assert.equal(f.overlays[0].options.position.latitude, 36.1)
  assert.equal(f.overlays[1].options.radius, 150)
  assert.equal(f.overlays[2].options.position.latitude, 37)
  scene.render({ cameras: [], events: [{ ...first, status: 'CONFIRMED' }, second, confirmed], selectedEvent: first })
  assert.ok(f.overlays.slice(0, 3).every(overlay => overlay.map === null))
  assert.equal(f.overlays.length, 5)
  assert.equal(f.overlays[4].options.position.latitude, 37)
})

test('카메라 선택은 상세 패널이 선택한 최신 이벤트와 같은 위치를 한 번에 맞춘다', () => {
  const older = { id: 10, cameraId: 1, status: 'UNCONFIRMED', detectedAt: '2026-01-01T00:00:00Z', estimatedLocation: fire }
  const latest = { id: 11, cameraId: 1, status: 'UNCONFIRMED', detectedAt: '2026-01-02T00:00:00Z', estimatedLocation: { latitude: 36.2, longitude: 128.2 } }
  const confirmed = { id: 12, cameraId: 1, status: 'CONFIRMED', detectedAt: '2026-01-03T00:00:00Z', estimatedLocation: { latitude: 37, longitude: 129 } }
  const events = [older, latest, confirmed]
  assert.deepEqual(focusLocationsForRequest({ kind: 'camera', id: 1 }, [camera], [older, latest]), [camera, latest.estimatedLocation])
  assert.deepEqual(focusLocationsForRequest({ kind: 'camera', id: 1 }, [camera], events), [camera])
  assert.deepEqual(focusLocationsForRequest({ kind: 'event', id: 10 }, [camera], events), [camera, fire])
  assert.deepEqual(focusLocationsForRequest({ kind: 'event', id: 12 }, [camera], events), [camera])
  assert.deepEqual(focusLocationsForRequest({ kind: 'camera', id: 9 }, [camera], events), [])
})

test('잘못되거나 미산출인 반경은 임의의 범위를 표시하지 않는다', () => {
  for (const radius of [null, undefined, NaN, Infinity, -1, '150']) {
    const f = fixture()
    createNaverScene(f.maps, f.map, () => {}).render({ cameras: [], selectedEvent: { estimatedLocation: { ...fire, errorRadiusM: radius } } })
    assert.equal(f.overlays.length, 1)
    assert.match(f.overlays[0].options.icon.content, /width:14px;height:14px/)
    assert.match(f.overlays[0].options.title, /오차 범위 미산출/)
  }
})

test('카메라 아이콘도 확대율에 따라 크기를 바꾸고 좌표 앵커를 유지한다', () => {
  const f = fixture()
  const scene = createNaverScene(f.maps, f.map, () => {})
  scene.render({ cameras: [camera], selectedCamera: camera, fireCameraIds: new Set([camera.id]) })
  const marker = f.overlays[0]
  assert.match(marker.options.icon.content, /width:24px;height:24px/)
  assert.equal(marker.options.icon.anchor.x, 12)
  assert.equal(marker.options.icon.anchor.y, 24)
  assert.match(marker.options.icon.content, /#e0402e/)
  const zoomListener = f.listeners.find(listener => listener.event === 'zoom_changed')
  assert.ok(zoomListener)
  f.map.setZoom(14)
  zoomListener.handler(14)
  assert.match(marker.options.icon.content, /width:48px;height:48px/)
  assert.equal(marker.options.icon.anchor.x, 24)
  assert.equal(marker.options.icon.anchor.y, 48)
})

test('이벤트 전환 시 이전 마커와 리스너를 제거하고 좌표 없는 이벤트는 표시하지 않는다', () => {
  const f = fixture()
  const scene = createNaverScene(f.maps, f.map, () => {})
  scene.render({ cameras: [camera], selectedCamera: camera, selectedEvent: { estimatedLocation: fire } })
  const old = [...f.overlays]
  const oldListeners = [...f.listeners]
  scene.render({ cameras: [camera], selectedEvent: { estimatedLocation: null } })
  assert.ok(old.every(overlay => overlay.map === null))
  assert.ok(oldListeners.every(listener => f.removed.includes(listener)))
  assert.equal(f.overlays.length, 4)
  scene.clear()
  assert.equal(f.overlays[3].map, null)
  assert.ok(f.listeners.every(listener => f.removed.includes(listener)))
})

test('전체 보기와 선택 위치 보기에서 유효한 좌표만 지도 중심 계산에 사용한다', () => {
  const f = fixture()
  const scene = createNaverScene(f.maps, f.map, () => {})
  scene.focus([null, camera])
  assert.equal(f.map.center.latitude, 36)
  assert.equal(f.map.zoom, 14)
  scene.focus([camera, fire, {}])
  assert.equal(f.map.bounds.length, 2)
})
