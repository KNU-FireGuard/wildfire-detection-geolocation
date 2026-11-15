import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileComponent, createHarness, findAll, allText, settle } from './helpers/vueHarness.js'
const api = `data:text/javascript,${encodeURIComponent(`
  export const fetchCameras = async () => globalThis.__catalogActions.cameras;
  export const fetchEvents = async () => globalThis.__catalogActions.events;
  export const fetchVideos = async () => globalThis.__catalogActions.videos;
  export const fetchLiveMonitorStatus = async () => ({cameras: []});
  export const fetchEvent = async id => ({...globalThis.__catalogActions.events.find(event => event.id === id)});
  export const deleteEvent = async id => {
    const state = globalThis.__catalogActions;
    state.deletes.push(id);
    if (state.failDelete || state.failedIds?.has(id)) throw new Error("삭제 실패");
  };
`)}`
globalThis.__catalogDialogComponent = await compileComponent(new URL('../src/components/RecordDialog.vue', import.meta.url))
const replacements = {
  "'../api/catalog'": JSON.stringify(api),
  "import RecordDialog from '../components/RecordDialog.vue'": 'const RecordDialog = globalThis.__catalogDialogComponent',
  "import EventCaptures from '../components/EventCaptures.vue'": `const EventCaptures = {
    props: ['eventId'], setup(props) { globalThis.__catalogActions.captureProps = props; return () => null; }
  }`,
  "import RecordedVideo from '../components/RecordedVideo.vue'": 'const RecordedVideo = {render: () => null}',
  "'../maps/naverScene'": JSON.stringify(new URL('../src/maps/naverScene.js', import.meta.url).href),
  '_resolveComponent("RouterLink")': '"a"',
}
for (const file of ['cameraName', 'cameraSearch', 'eventFormat']) replacements[`'../utils/${file}'`] = JSON.stringify(new URL(`../src/utils/${file}.js`, import.meta.url).href)
replacements["'../composables/useQuery'"] = JSON.stringify(new URL('../src/composables/useQuery.js', import.meta.url).href)
const component = await compileComponent(new URL('../src/views/CatalogView.vue', import.meta.url), replacements)

function setup(resource) {
  const previous = { document: globalThis.document, window: globalThis.window, Document: globalThis.Document, ShadowRoot: globalThis.ShadowRoot }
  const state = {
    cameras: [{ id: 7, name: '기도4교', latitude: 0, longitude: 128.1, sourceType: 'test' },
      { id: 8, name: '청성', latitude: 36.1, longitude: 128.2, sourceType: 'live' }],
    events: [{ id: 9, cameraId: 7, type: 'fire', detectedAt: new Date().toISOString(), status: 'UNCONFIRMED' }], deletes: [],
    videos: [{id: 1, camera_id: 7, original_filename: 'demo-camera-7.mp4'},
      {id: 2, camera_id: 8, original_filename: 'other-camera.mp4'}],
  }
  globalThis.__catalogActions = state
  const harness = createHarness()
  globalThis.Document = class {}
  globalThis.ShadowRoot = class {}
  globalThis.document = Object.assign(new globalThis.Document(), { body: harness.body })
  globalThis.window = { confirm: () => true }
  const view = harness.mount(component, { resource })
  return { ...view, state, dispose() { view.app.unmount(); Object.assign(globalThis, previous); delete globalThis.__catalogActions } }
}

test('카메라 검색 후 더블클릭·Enter로 위경도와 유형 상세 팝업을 확인한다', async () => {
  const view = setup('cameras')
  try {
    await settle()
    const input = findAll(view.root, 'input')[0]
    input.props['onUpdate:modelValue']('기도 테스트')
    await settle()
    const row = findAll(view.root, 'tr').find(node => node.props.class === 'camera-row')
    assert.match(allText(row), /기도4교/)
    assert.equal(findAll(view.root, 'tr').length, 2)
    row.props.onDblclick()
    await settle()
    const dialog = findAll(view.body, 'dialog').find(node => node.open)
    assert.ok(dialog)
    assert.match(allText(dialog), /위도.*0.*경도.*128.1/)
    assert.match(allText(dialog), /테스트 CCTV/)
    assert.match(allText(dialog), /demo-camera-7\.mp4/)
    assert.doesNotMatch(allText(dialog), /other-camera\.mp4/)
    findAll(dialog, 'button').find(node => node.props['aria-label'] === '팝업 닫기').props.onClick()
    await settle()
    assert.equal(dialog.open, false)
    row.props.onKeydown({ key: 'Enter' })
    await settle()
    assert.equal(dialog.open, true)
  } finally { view.dispose() }
})

test('이벤트 더블클릭으로 상세를 보고 선택 삭제 취소·실패는 보존하며 성공하면 제거한다', async () => {
  const view = setup('events')
  try {
    await settle()
    const row = findAll(view.root, 'tr').find(node => node.props.class?.includes('event-row'))
    assert.equal(row.props.onClick, undefined, '단일 클릭으로 상세를 열지 않음')
    row.props.onDblclick()
    await settle()
    const dialog = findAll(view.body, 'dialog').find(node => node.open)
    assert.ok(dialog)
    assert.equal(view.state.captureProps.eventId, 9)
    findAll(row, 'input')[0].props.onChange({target: {checked: true}})
    await settle()
    const remove = () => findAll(view.root, 'button').find(node => /선택 삭제/.test(allText(node))).props.onClick()
    globalThis.window.confirm = () => false
    await remove()
    assert.equal(view.state.deletes.length, 0)
    globalThis.window.confirm = () => true
    view.state.failDelete = true
    await remove(); await settle()
    assert.match(allText(view.root), /삭제 실패/)
    assert.ok(dialog.open)
    assert.equal(findAll(view.root, 'tr').length, 2)
    view.state.failDelete = false
    await remove(); await settle()
    assert.equal(findAll(view.root, 'tr').length, 0)
    assert.equal(dialog.open, false)
  } finally { view.dispose() }
})

test('전체 선택 삭제의 부분 실패는 실패 항목만 선택 상태로 남기고 재시도한다', async () => {
  const view = setup('events')
  view.state.events.push({id: 10, cameraId: 8, type: 'smoke', detectedAt: new Date().toISOString(), status: 'UNCONFIRMED'})
  view.state.failedIds = new Set([10])
  try {
    await settle()
    findAll(view.root, 'input').find(node => node.props['aria-label'] === '이벤트 전체 선택')
      .props.onChange({target: {checked: true}})
    await settle()
    const remove = () => findAll(view.root, 'button').find(node => /선택 삭제/.test(allText(node))).props.onClick()
    await remove(); await settle()
    assert.deepEqual(view.state.deletes, [9, 10])
    assert.match(allText(view.root), /1건은 삭제하지 못했습니다/)
    const remaining = findAll(view.root, 'tr').filter(node => node.props.class?.includes('event-row'))
    assert.equal(remaining.length, 1)
    assert.equal(findAll(remaining[0], 'input')[0].props.checked, true)
    view.state.failedIds.clear()
    await remove(); await settle()
    assert.deepEqual(view.state.deletes, [9, 10, 10])
    assert.equal(findAll(view.root, 'tr').length, 0)
  } finally { view.dispose() }
})
