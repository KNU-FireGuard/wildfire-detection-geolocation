import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'
import { summarizeOperatingCameras } from '../src/utils/cameraSummary.js'

const live = (id, streamUrl = `http://example.test/${id}.m3u8`) => ({ id, sourceType: 'live', status: null, streamUrl })
const test4 = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, sourceType: 'test', status: null }))

test('실제 API 데이터에서는 Test 카메라를 빼고 영상이 연결된 실시간 CCTV 수를 센다', () => {
  const cameras = [...test4, ...Array.from({ length: 6 }, (_, i) => live(21 + i))]
  assert.deepEqual(summarizeOperatingCameras(cameras), { online: 6, total: 6 })
})

test('영상 주소가 없는 실시간 CCTV는 운영 중으로 세지 않지만 전체에는 포함한다', () => {
  const cameras = [...test4, live(21), live(22, null), live(23, '')]
  assert.deepEqual(summarizeOperatingCameras(cameras), { online: 1, total: 3 })
})

test('상태 값이 있는 개발용 예시 데이터에서는 ONLINE 카메라 수와 전체 수를 센다', () => {
  const cameras = [{ id: 'a', status: 'ONLINE' }, { id: 'b', status: 'OFFLINE' }, { id: 'c', status: 'ONLINE' }]
  assert.deepEqual(summarizeOperatingCameras(cameras), { online: 2, total: 3 })
})

test('카메라가 없으면 0대로 표시한다', () => {
  assert.deepEqual(summarizeOperatingCameras([]), { online: 0, total: 0 })
})

const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

test('대시보드의 운영 중인 CCTV 카드는 집계 함수의 값을 쓰고 더 이상 전체 카메라 수를 분모로 쓰지 않는다', () => {
  const { descriptor } = parse(read('views/DashboardView.vue'))
  assert.match(descriptor.scriptSetup.content, /summarizeOperatingCameras\(cameras\.value\)/)
  assert.match(descriptor.template.content, /운영 중인 CCTV[\s\S]*?\{\{ operating\.online \}\}[\s\S]*?\/ \{\{ operating\.total \}\}/)
  assert.doesNotMatch(descriptor.template.content, /\/ \{\{ cameras\.length \}\}/)
})

test('지도 아래에는 이벤트 선택 안내 문구를 두지 않고 카메라가 없을 때의 안내만 남긴다', () => {
  const template = parse(read('components/MonitoringMap.vue')).descriptor.template.content
  assert.doesNotMatch(template, /이벤트를 선택하면 추정 위치를 확인할 수 있습니다/)
  assert.match(template, /등록된 카메라가 없습니다/)
})

test('실시간 CCTV 영역에는 재생 안내 부제를 두지 않는다', () => {
  const template = parse(read('components/LiveCctvWall.vue')).descriptor.template.content
  assert.doesNotMatch(template, /관제 화면이 열려 있는 동안/)
  assert.match(template, /<h2>실시간 CCTV<\/h2>/)
})
