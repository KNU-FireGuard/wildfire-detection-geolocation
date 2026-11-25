import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileComponent, createHarness, findAll, settle } from './helpers/vueHarness.js'

const component = await compileComponent(new URL('../src/components/RecordedVideo.vue', import.meta.url))
test('새 분석 시작 신호를 받으면 원본 영상을 처음부터 다시 재생한다', async () => {
  const view = createHarness().mount(component, { videoId: 7, sequence: 0 })
  try {
    const player = findAll(view.root, 'video')[0]
    assert.equal(player.props.src, '/api/videos/7/stream')
    Object.assign(player, { readyState: 1, duration: 60, currentTime: 0, play: async () => {} })
    player.props.onLoadedmetadata()
    assert.equal(player.currentTime, 0)
    player.currentTime = 8.8
    view.props.sequence++
    await settle()
    assert.equal(player.currentTime, 0)
    player.currentTime = 20
    view.props.sequence++
    await settle()
    assert.equal(player.currentTime, 0)
  } finally { view.app.unmount() }
})
