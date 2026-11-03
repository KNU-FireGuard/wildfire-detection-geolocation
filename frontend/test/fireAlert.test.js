import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'
import { activeFireCameraIds, findNewFireEvents, ACTIVE_FIRE_WINDOW_MS } from '../src/utils/fireAlert.js'
import { cameraName } from '../src/utils/cameraName.js'
import { createNaverScene } from '../src/maps/naverScene.js'

const now = Date.parse('2026-11-04T12:00:00Z')
const at = minutes => new Date(now - minutes * 60000).toISOString()
const event = (id, cameraId, type, minutes, status = null) => ({ id, cameraId, type, detectedAt: at(minutes), status })

test('최근 화재(fire) 이벤트가 있는 카메라만 화재 카메라로 본다', () => {
  const events = [event(1, 10, 'fire', 5), event(2, 11, 'smoke', 1), event(3, 12, 'fire', ACTIVE_FIRE_WINDOW_MS / 60000 + 1), event(4, 13, 'fire', 2, 'CONFIRMED'), event(5, 14, 'fire', 3, 'UNCONFIRMED')]
  assert.deepEqual([...activeFireCameraIds(events, now)].sort(), [10, 14])
})

test('시각이 잘못된 이벤트와 카메라 없는 이벤트는 화재 카메라에 넣지 않는다', () => {
  const events = [{ id: 1, cameraId: 10, type: 'fire', detectedAt: 'bad' }, event(2, null, 'fire', 1)]
  assert.equal(activeFireCameraIds(events, now).size, 0)
})

test('이미 본 이벤트를 제외한 새 화재 이벤트만 돌려주고 첫 조회에서는 알리지 않는다', () => {
  const events = [event(1, 10, 'fire', 5), event(2, 11, 'smoke', 1), event(3, 12, 'fire', 1)]
  assert.deepEqual(findNewFireEvents(null, events, now), [])
  assert.deepEqual(findNewFireEvents(new Set([1, 2]), events, now).map(item => item.id), [3])
  assert.deepEqual(findNewFireEvents(new Set([1, 2, 3]), events, now), [])
})

test('오래된 화재 이벤트가 뒤늦게 목록에 나타나도 새 알림으로 보지 않는다', () => {
  assert.deepEqual(findNewFireEvents(new Set(), [event(9, 10, 'fire', 600)], now), [])
})

test('카메라 이름을 찾고 없으면 안내 문구를 돌려준다', () => {
  const cameras = [{ id: 1, name: '고성' }]
  assert.equal(cameraName(1, cameras), '고성')
  assert.equal(cameraName(7, cameras), '카메라 7')
  assert.equal(cameraName(null, cameras), '카메라 정보 없음')
})

function mapFixture() {
  const overlays = []
  class Overlay { constructor(options) { this.options = options; overlays.push(this) } setMap() {} }
  const maps = { LatLng: class { constructor(latitude, longitude) { Object.assign(this, { latitude, longitude }) } }, Point: class {}, Marker: Overlay, Polyline: Overlay, Event: { addListener: () => ({}), removeListener() {} } }
  return { maps, overlays }
}

test('화재 카메라 마커는 빨간색이고 다른 카메라 위에 표시된다', () => {
  const f = mapFixture()
  const scene = createNaverScene(f.maps, {}, () => {})
  const cameras = [{ id: 1, name: 'A', latitude: 36, longitude: 128 }, { id: 2, name: 'B', latitude: 37, longitude: 128 }]
  scene.render({ cameras, fireCameraIds: new Set([2]) })
  const [normal, fire] = f.overlays
  assert.ok(!normal.options.icon.content.includes('e0402e'))
  assert.ok(fire.options.icon.content.includes('e0402e'))
  assert.ok(fire.options.zIndex > normal.options.zIndex)
  scene.render({ cameras })
  assert.ok(!f.overlays[2].options.icon.content.includes('e0402e'))
})

const sfc = path => parse(readFileSync(new URL(path, import.meta.url), 'utf8')).descriptor

test('화재 알림 배너는 role=alert로 카메라 이름과 이동·닫기 버튼을 보여준다', () => {
  const template = sfc('../src/components/FireAlertBanner.vue').template.content
  assert.match(template, /role="alert"/)
  assert.match(template, /emit\('open'/)
  assert.match(template, /emit\('dismiss'\)/)
})

test('대시보드는 새 화재를 배너로 알리고 지도에 화재 카메라를 전달한다', () => {
  const dash = readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8')
  assert.match(dash, /<FireAlertBanner/)
  assert.match(dash, /findNewFireEvents\(/)
  assert.match(dash, /:fire-camera-ids="fireCameraIds"/)
})

test('이벤트 전체 목록은 카메라 ID 대신 카메라 이름을 보여준다', () => {
  const catalog = readFileSync(new URL('../src/views/CatalogView.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(catalog, /<th>카메라 ID<\/th>/)
  assert.match(catalog, /<th>카메라<\/th>/)
  assert.match(catalog, /row\.cameraName/)
})
