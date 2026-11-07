import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileComponent, createHarness, findAll, allText, settle } from './helpers/vueHarness.js'

const fixture = `data:text/javascript,${encodeURIComponent(`
  export const fetchEventCaptures = async (id, options) => {
    const state = globalThis.__capturesTest;
    state.requests.push({id, before: options.before});
    if (state.error) throw new Error("capture unavailable");
    const items = options.before == null ? state.items : state.items.filter(item => item.video_time_ms < options.before);
    return {items: items.slice(0, 20), limit: 20, offset: 0};
  };
`)}`
const component = await compileComponent(new URL('../src/components/EventCaptures.vue', import.meta.url), {
  "'../api/catalog'": JSON.stringify(fixture),
})
const capture = (id, time) => ({ id, video_time_ms: time, image_url: `/api/event-captures/${id}/image` })

test('캡처는 시간순으로 표시·선택하고 새 캡처를 중복 없이 합치며 이벤트 전환 시 초기화한다', async () => {
  const previous = globalThis.document
  globalThis.document = { hidden: true }
  const state = { items: [capture(2, 8800), capture(1, 3800)], requests: [] }
  globalThis.__capturesTest = state
  const seeks = []
  const view = createHarness().mount(component, { eventId: 9 }, { onSeek: time => seeks.push(time) })
  try {
    await settle()
    assert.deepEqual(findAll(view.root, 'img').map(node => node.props.src), ['/api/event-captures/1/image', '/api/event-captures/2/image'])
    findAll(view.root, 'button')[0].props.onClick()
    assert.deepEqual(seeks, [3.8])
    state.items = [capture(3, 13800), ...state.items]
    view.props.latestCapture = { id: 3 }
    await settle()
    assert.equal(findAll(view.root, 'img').length, 3)
    state.items = []
    view.props.eventId = 10
    await settle()
    assert.equal(findAll(view.root, 'img').length, 0)
    state.error = true
    view.props.latestCapture = { id: 4 }
    await settle()
    assert.match(allText(view.root), /capture unavailable/)
    state.error = false
    state.items = [capture(4, 4000)]
    findAll(view.root, 'button')[0].props.onClick()
    await settle()
    assert.equal(findAll(view.root, 'img').length, 1)
  } finally { view.app.unmount(); globalThis.document = previous; delete globalThis.__capturesTest }
})

test('캡처가 빠르게 늘어도 이전 기록은 영상 시각 커서로 빠짐없이 조회한다', async () => {
  const previous = globalThis.document
  globalThis.document = { hidden: true }
  const state = { items: [capture(1, 3800)], requests: [] }
  globalThis.__capturesTest = state
  const view = createHarness().mount(component, { eventId: 9 })
  try {
    await settle()
    state.items = Array.from({ length: 25 }, (_, i) => capture(i + 1, 3800 + i * 5000)).reverse()
    view.props.latestCapture = { id: 25 }
    await settle()
    assert.equal(findAll(view.root, 'img').length, 20)
    findAll(view.root, 'button').find(node => /이전 캡처 더 보기/.test(allText(node))).props.onClick()
    await settle()
    assert.equal(findAll(view.root, 'img').length, 25)
    assert.equal(state.requests.at(-1).before, 28800)
    assert.deepEqual(findAll(view.root, 'img').map(node => node.props.src),
      Array.from({ length: 25 }, (_, i) => `/api/event-captures/${i + 1}/image`))
  } finally { view.app.unmount(); globalThis.document = previous; delete globalThis.__capturesTest }
})
