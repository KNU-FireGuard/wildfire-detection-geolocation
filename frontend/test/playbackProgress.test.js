import assert from 'node:assert/strict'
import { test } from 'node:test'
import { trackPlaybackProgress } from '../src/utils/playbackProgress.js'

test('재생 시각이 뒤로 이동한 뒤 다시 증가하면 재생 진행을 감지한다', () => {
  let state = trackPlaybackProgress(120, 30)
  assert.deepEqual(state, { lastTime: 30, progressed: false })

  state = trackPlaybackProgress(state.lastTime, 30.25)
  assert.deepEqual(state, { lastTime: 30.25, progressed: true })
})
