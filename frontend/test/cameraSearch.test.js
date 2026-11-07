import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterCameras } from '../src/utils/cameraSearch.js'
test('카메라 이름·ID·좌표·유형과 복수 검색어를 검색하고 원본은 유지한다', () => {
  const cameras = [{ id: 1, name: '기도4교', sourceType: 'test', latitude: 0, longitude: 128.1 },
    { id: 2, name: '청성', sourceType: 'live', latitude: null, longitude: null }]
  assert.deepEqual(filterCameras(cameras, ' 기도 테스트 '), [cameras[0]])
  assert.deepEqual(filterCameras(cameras, '실시간'), [cameras[1]])
  assert.deepEqual(filterCameras(cameras, '128.1'), [cameras[0]])
  assert.deepEqual(filterCameras(cameras, 'missing'), [])
  assert.equal(filterCameras(cameras, '').length, 2)
  assert.equal(cameras.length, 2)
})
