import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileComponent, createHarness, findAll, settle } from './helpers/vueHarness.js'
const api = `data:text/javascript,${encodeURIComponent(`
  export const startTestRun = async id => ({ id: 77, camera_id: id, video_id: 7, status: 'ready' });
  export const fetchTestRunStatus = async () => ({ status: 'completed' });
`)}`
const component = await compileComponent(new URL('../src/components/TestRunPanel.vue', import.meta.url), { "'../api/catalog'": JSON.stringify(api) })
test('Test 시작은 원본 영상 ID를 전달하고 MJPEG 연결 없이 상태·이벤트만 갱신한다', async () => {
  const oldInterval = globalThis.setInterval
  const oldClear = globalThis.clearInterval
  let poll
  globalThis.setInterval = callback => { poll = callback; return 1 }
  globalThis.clearInterval = () => {}
  const starts = []
  let updates = 0
  const view = createHarness().mount(component, { cameraId: 3 }, {
    onStarted: run => starts.push(run), onEventsUpdated: () => { updates++ },
  })
  try {
    await findAll(view.root, 'button')[0].props.onClick()
    await settle()
    assert.equal(starts[0].video_id, 7)
    await poll()
    await settle()
    assert.equal(updates, 1)
  } finally { view.app.unmount(); globalThis.setInterval = oldInterval; globalThis.clearInterval = oldClear }
})
