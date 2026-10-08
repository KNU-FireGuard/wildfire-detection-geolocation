import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNaverScene, hasCoordinates } from '../src/maps/naverScene.js'
import { loadNaverMaps } from '../src/maps/naverLoader.js'

function fixture() {
  const overlays = [], listeners = [], removed = []
  class Overlay {
    constructor(options) { this.options = options; overlays.push(this) }
    setMap(map) { this.map = map }
  }
  const maps = {
    LatLng: class { constructor(latitude, longitude) { Object.assign(this, { latitude, longitude }) } },
    Point: class {}, Marker: Overlay, Polyline: Overlay,
    Event: { addListener: (target, event, handler) => { const listener = { target, event, handler }; listeners.push(listener); return listener }, removeListener: listener => removed.push(listener) },
  }
  const map = { setCenter: position => { map.center = position }, setZoom: zoom => { map.zoom = zoom }, fitBounds: bounds => { map.bounds = bounds } }
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

test('이벤트 전환 시 이전 마커와 리스너를 제거하고 좌표 없는 이벤트는 표시하지 않는다', () => {
  const f = fixture()
  const scene = createNaverScene(f.maps, f.map, () => {})
  scene.render({ cameras: [camera], selectedCamera: camera, selectedEvent: { estimatedLocation: fire } })
  const old = [...f.overlays]
  scene.render({ cameras: [camera], selectedEvent: { estimatedLocation: null } })
  assert.ok(old.every(overlay => overlay.map === null))
  assert.equal(f.removed.length, 1)
  assert.equal(f.overlays.length, 4)
  scene.clear()
  assert.equal(f.overlays[3].map, null)
  assert.equal(f.removed.length, 2)
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
