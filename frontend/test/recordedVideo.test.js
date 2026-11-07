import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileComponent, createHarness, findAll, settle } from './helpers/vueHarness.js'

const component = await compileComponent(new URL('../src/components/RecordedVideo.vue', import.meta.url))
test('캡처 선택 시 원본의 해당 시점으로 이동하고 같은 시점 재선택도 처리한다', async () => {
  const view = createHarness().mount(component, { videoId: 7, position: 3.8, sequence: 0 })
  try {
    const player = findAll(view.root, 'video')[0]
    assert.equal(player.props.src, '/api/videos/7/stream')
    Object.assign(player, { readyState: 1, duration: 60, currentTime: 0, play: async () => {} })
    player.props.onLoadedmetadata()
    assert.equal(player.currentTime, 3.8)
    view.props.position = 8.8
    view.props.sequence++
    await settle()
    assert.equal(player.currentTime, 8.8)
    player.currentTime = 20
    view.props.sequence++
    await settle()
    assert.equal(player.currentTime, 8.8)
    view.props.position = 100
    await settle()
    assert.equal(player.currentTime, 60)
  } finally { view.app.unmount() }
})
