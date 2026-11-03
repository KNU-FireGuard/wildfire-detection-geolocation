import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'
import { activeFireCameraIds, findNewFireEvents } from '../src/utils/fireAlert.js'
import { cameraName } from '../src/utils/cameraName.js'
import { createNaverScene } from '../src/maps/naverScene.js'

const now = Date.parse('2026-11-04T12:00:00Z')
const at = minutes => new Date(now - minutes * 60000).toISOString()
const event = (id, cameraId, type, minutes, status = null) => ({ id, cameraId, type, detectedAt: at(minutes), status })

test('서버가 알림 중(is_alerting)이라고 알려준 화재 이벤트가 있는 카메라만 화재 카메라로 본다', () => {
  const alerting = (id, cameraId, type, value) => ({ ...event(id, cameraId, type, 1), alerting: value })
  const events = [alerting(1, 10, 'fire', true), alerting(2, 11, 'smoke', true), alerting(3, 12, 'fire', false), alerting(4, 14, 'fire', true)]
  assert.deepEqual([...activeFireCameraIds(events)].sort((a, b) => a - b), [10, 14])
})

test('알림 중 값이 없는 데이터(개발용 예시)는 확인 여부로 판단한다', () => {
  const events = [event(1, 10, 'fire', 5, 'UNCONFIRMED'), event(2, 11, 'fire', 5, 'CONFIRMED')]
  assert.deepEqual([...activeFireCameraIds(events)], [10])
})

test('같은 카메라에 알림이 끝난 화재와 알림 중인 화재가 함께 있으면 빨간색을 유지한다', () => {
  const events = [{ ...event(1, 10, 'fire', 90), alerting: false }, { ...event(2, 10, 'fire', 1), alerting: true }]
  assert.deepEqual([...activeFireCameraIds(events)], [10])
})

test('카메라 없는 이벤트는 화재 카메라에 넣지 않는다', () => {
  assert.equal(activeFireCameraIds([{ ...event(2, null, 'fire', 1), alerting: true }]).size, 0)
})

test('이미 본 이벤트를 제외한 알림 중인 새 화재 이벤트만 돌려주고 첫 조회에서는 알리지 않는다', () => {
  const events = [{ ...event(1, 10, 'fire', 5), alerting: true }, event(2, 11, 'smoke', 1), { ...event(3, 12, 'fire', 1), alerting: true }, { ...event(4, 13, 'fire', 1), alerting: false }]
  assert.deepEqual(findNewFireEvents(null, events), [])
  assert.deepEqual(findNewFireEvents(new Set([1, 2]), events).map(item => item.id), [3])
  assert.deepEqual(findNewFireEvents(new Set([1, 2, 3, 4]), events), [])
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
  assert.match(template, /emit\('acknowledge', events\.map/)
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

test('이벤트 목록의 확인 대기 행에는 확인 버튼이 있고 대시보드는 관리자 로그인 후 확인한다', () => {
  const list = sfc('../src/components/EventList.vue').template.content
  assert.match(list, /event\.status === 'UNCONFIRMED'/)
  assert.match(list, /emit\('acknowledge', event\.id\)/)
  const dash = readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8')
  assert.match(dash, /acknowledgeEvent\(/)
  assert.match(dash, /@acknowledge="acknowledge"/)
  assert.match(dash, /ensureAdminToken\(loginAdmin/)
  // 확인 직후 다음 갱신을 기다리지 않고 바로 빨간색을 끔
  assert.match(dash, /status: 'CONFIRMED', alerting: false/)
})
