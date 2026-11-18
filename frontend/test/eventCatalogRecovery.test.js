import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryHistory, createRouter } from 'vue-router'
import { compileComponent, createHarness, findAll, allText, settle } from './helpers/vueHarness.js'
import { useAdminSession } from '../src/composables/useAdminSession.js'

globalThis.__catalogRecoveryIcon = await compileComponent(new URL('../src/components/DashboardIcon.vue', import.meta.url))
const api = `data:text/javascript,${encodeURIComponent(`
  export const fetchCameras = async () => [{ id: 7, name: '청성', sourceType: 'test' }];
  export const fetchEvents = async () => globalThis.__catalogRecovery.events.map(event => ({ ...event }));
  export const fetchVideos = async () => [];
  export const fetchEvent = async () => null;
  export const fetchLiveMonitorStatus = async () => ({ cameras: [] });
  export const deleteEvent = async id => {
    const state = globalThis.__catalogRecovery;
    state.requests.push(id);
    await state.pending;
    state.events = state.events.filter(event => event.id !== id);
    if (state.notFound) throw Object.assign(new Error('이미 삭제됨'), { status: 404 });
  };
`)}`
const replacements = {
  "'vue-router'": JSON.stringify(import.meta.resolve('vue-router')),
  "'../api/catalog'": JSON.stringify(api),
  "import RecordDialog from '../components/RecordDialog.vue'": 'const RecordDialog = { render: () => null }',
  "import DashboardIcon from '../components/DashboardIcon.vue'": 'const DashboardIcon = globalThis.__catalogRecoveryIcon',
  "import EventCaptures from '../components/EventCaptures.vue'": 'const EventCaptures = { render: () => null }',
  "import RecordedVideo from '../components/RecordedVideo.vue'": 'const RecordedVideo = { render: () => null }',
}
for (const path of ['utils/eventCatalog', 'utils/eventFormat', 'utils/cameraName', 'utils/cameraSearch', 'maps/naverScene', 'composables/useQuery', 'composables/useAdminSession']) {
  replacements[`'../${path}'`] = JSON.stringify(new URL(`../src/${path}.js`, import.meta.url).href)
}
const component = await compileComponent(new URL('../src/views/CatalogView.vue', import.meta.url), replacements)

async function setup() {
  const previous = { document: globalThis.document, window: globalThis.window, Document: globalThis.Document, ShadowRoot: globalThis.ShadowRoot }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/events', component }] })
  await router.push('/events')
  await router.isReady()
  const state = {
    events: [1, 2].map(id => ({ id, cameraId: 7, type: 'fire', status: 'UNCONFIRMED', detectedAt: '2026-11-18T00:00:00Z' })),
    requests: [], pending: Promise.resolve(),
  }
  globalThis.__catalogRecovery = state
  const harness = createHarness()
  globalThis.Document = class {}
  globalThis.ShadowRoot = class {}
  globalThis.document = Object.assign(new globalThis.Document(), { body: harness.body })
  globalThis.window = { confirm: () => true }
  useAdminSession().signIn('recovery-test-token')
  const view = harness.mount(component, { resource: 'events' }, {}, [router])
  await settle()
  return { ...view, state, router, dispose() {
    view.app.unmount()
    useAdminSession().signOut()
    Object.assign(globalThis, previous)
    delete globalThis.__catalogRecovery
  } }
}
const control = (view, label) => [...findAll(view.root, 'input'), ...findAll(view.root, 'select')].find(node => node.props['aria-label'] === label)
const button = (view, label) => findAll(view.root, 'button').find(node => node.props['aria-label'] === label || allText(node).trim() === label)
const visibleIds = view => findAll(view.root, 'tr').filter(node => node.props.class?.includes('event-row')).map(node => Number(allText(findAll(node, 'td')[1]).trim()))

test('기본 URL에서도 초기화는 적용 전 입력값과 날짜 오류를 지운다', async () => {
  const view = await setup()
  try {
    control(view, '카메라 이름 또는 이벤트 번호 검색').props['onUpdate:modelValue']('미적용 검색어')
    control(view, '이벤트 유형 필터').props['onUpdate:modelValue']('smoke')
    control(view, '카메라 필터').props['onUpdate:modelValue']('7')
    button(view, '직접 기간').props.onClick()
    await settle()
    control(view, '시작일').props['onUpdate:modelValue']('2026-11-18')
    control(view, '종료일').props['onUpdate:modelValue']('2026-11-17')
    await findAll(view.root, 'form')[0].props.onSubmit({ preventDefault() {} })
    await settle()
    assert.match(allText(view.root), /종료일은 시작일/)
    await button(view, '모든 필터 초기화').props.onClick()
    await settle()
    assert.deepEqual(view.router.currentRoute.value.query, {})
    assert.equal(control(view, '카메라 이름 또는 이벤트 번호 검색').props.value, '')
    assert.equal(control(view, '이벤트 유형 필터').selectedIndex, 0)
    assert.equal(control(view, '카메라 필터').selectedIndex, 0)
    assert.equal(control(view, '시작일'), undefined)
    assert.doesNotMatch(allText(view.root), /종료일은 시작일/)
    assert.deepEqual(visibleIds(view), [1, 2])
  } finally { view.dispose() }
})

for (const notFound of [false, true]) {
  test(`삭제 중 뒤로가기는 후속 삭제를 중단하고 이미 제거된 이벤트를 목록에 반영한다 (404=${notFound})`, async () => {
    const view = await setup()
    let finishDelete
    view.state.pending = new Promise(resolve => { finishDelete = resolve })
    view.state.notFound = notFound
    try {
      await view.router.push({ query: { type: 'fire' } })
      await settle()
      control(view, '현재 페이지 이벤트 전체 선택').props.onChange({ target: { checked: true } })
      await settle()
      const deletion = button(view, '선택 삭제').props.onClick()
      view.router.back()
      await settle()
      assert.deepEqual(view.router.currentRoute.value.query, {})
      finishDelete()
      await deletion
      await settle()
      assert.deepEqual(view.state.requests, [1])
      assert.deepEqual(view.state.events.map(event => event.id), [2])
      assert.deepEqual(visibleIds(view), [2])
      assert.match(allText(view.root), /전체 1건/)
      assert.equal(useAdminSession().token.value, 'recovery-test-token')
    } finally { finishDelete(); view.dispose() }
  })
}
