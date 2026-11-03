import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getLiveVideo, registerLiveVideo, unregisterLiveVideo } from '../src/composables/liveVideoRegistry.js'

test('카메라 ID로 영상 월의 video 요소를 등록하고 조회하고 해제한다', () => {
  const element = { name: 'video-1' }
  assert.equal(getLiveVideo(1), null)
  registerLiveVideo(1, element)
  assert.equal(getLiveVideo(1), element)
  unregisterLiveVideo(1, element)
  assert.equal(getLiveVideo(1), null)
})

test('다른 요소가 다시 등록된 뒤에는 이전 요소의 해제가 새 등록을 지우지 않는다', () => {
  const first = { name: 'first' }
  const second = { name: 'second' }
  registerLiveVideo(2, first)
  registerLiveVideo(2, second)
  unregisterLiveVideo(2, first)
  assert.equal(getLiveVideo(2), second)
  unregisterLiveVideo(2, second)
})
