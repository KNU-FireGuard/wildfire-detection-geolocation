import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'
import { findRequestedCameraId } from '../src/utils/cameraLink.js'

const cameras = [{ id: 5 }, { id: 21 }]

test('주소의 camera 값이 목록에 있는 카메라면 그 ID를 돌려준다', () => {
  assert.equal(findRequestedCameraId('21', cameras), 21)
  assert.equal(findRequestedCameraId(['5'], cameras), 5)
})

test('없는 카메라, 숫자가 아닌 값, 빈 값은 선택하지 않는다', () => {
  for (const value of ['99', 'abc', '', '2x', undefined, null]) assert.equal(findRequestedCameraId(value, cameras), null)
})

const catalog = parse(readFileSync(new URL('../src/views/CatalogView.vue', import.meta.url), 'utf8')).descriptor.template.content
const cameraTable = catalog.match(/<table v-if="resource === 'cameras'">[\s\S]*?<\/table>/)[0]

test('카메라 목록 행을 더블클릭하거나 Enter를 누르면 상세 팝업을 연다', () => {
  assert.doesNotMatch(cameraTable, /<th>ID<\/th>/)
  assert.doesNotMatch(cameraTable, /row\.id }}/)
  assert.doesNotMatch(cameraTable, /<th>대시보드<\/th>/)
  assert.doesNotMatch(cameraTable, /RouterLink/)
  assert.match(cameraTable, /@dblclick="openCamera\(row\)"/)
  assert.match(cameraTable, /@keydown\.enter="openCamera\(row\)"/)
})

test('탐지 이벤트 표의 ID 열은 그대로 둔다', () => {
  assert.match(catalog, /<th>ID<\/th><th>탐지 시각<\/th>/)
})

test('대시보드는 주소의 camera 값을 첫 조회 뒤 한 번만 선택에 반영한다', () => {
  const dash = readFileSync(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8')
  assert.match(dash, /findRequestedCameraId\(route\.query\.camera/)
})
