import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileComponent, createHarness, findAll, settle } from './helpers/vueHarness.js'

const fixtureCode = `
  const state = () => globalThis.__dashboardAlertsTest;
  export const fetchCameras = async () => state().cameras;
  export const fetchEvents = async () => { state().eventReads++; return state().events; };
  export const fetchVideos = async () => [];
  export const fetchLiveCctvs = async () => ({ cameras: [] });
  export const fetchLiveMonitorStatus = async () => ({ cameras: [] });
  export const refreshLiveCctvs = async () => { state().refreshes++; };
  export const acknowledgeEvent = async id => { state().acks.push(id); await state().onAck(id); };
`
const fixtureUrl = `data:text/javascript,${encodeURIComponent(fixtureCode)}`
const replacements = {
  "'../api/catalog'": `'${fixtureUrl}'`,
  "import { useRoute } from 'vue-router'": 'const useRoute = () => ({ query: {} })',
  "import { playAlertTone } from '../utils/alertSound'": 'const playAlertTone = () => { globalThis.__dashboardAlertsTest.tones++ }',
  'import.meta.env.VITE_DATA_SOURCE': "'api'",
}
for (const [name, file] of Object.entries({ retainSelection: 'dashboardSelection', summarizeOperatingCameras: 'cameraSummary', findRequestedCameraId: 'cameraLink' })) {
  replacements[`'../utils/${file}'`] = `'${new URL(`../src/utils/${file}.js`, import.meta.url).href}'`
}
replacements["'../utils/fireAlert'"] = `'${new URL('../src/utils/fireAlert.js', import.meta.url).href}'`
for (const file of ['cameras', 'events']) replacements[`'../mocks/${file}'`] = `'${new URL(`../src/mocks/${file}.js`, import.meta.url).href}'`
for (const name of ['DashboardIcon', 'MonitoringMap', 'LiveCctvWall']) {
  replacements[`import ${name} from '../components/${name}.vue'`] = `const ${name} = { inheritAttrs: false, render: () => null }`
}
replacements["import EventDetail from '../components/EventDetail.vue'"] = `const EventDetail = {
  inheritAttrs: false, props: ['event', 'camera', 'videos'], emits: ['test-started'],
  setup(props, {emit}) {
    globalThis.__dashboardAlertsTest.detail = {props, start: run => emit('test-started', run)};
    return () => null;
  }
}`
for (const [name, key] of [['DetectionAlertModal', 'modal'], ['EventList', 'list']]) {
  replacements[`import ${name} from '../components/${name}.vue'`] = `
    const ${name} = { inheritAttrs: false, props: ['events', 'cameras', 'busy', 'error', 'ackBusy'],
      emits: ['acknowledge', 'dismiss', 'open', 'select'], setup(props, { emit }) {
        globalThis.__dashboardAlertsTest.${key} = { props, select: id => emit('select', id), open: id => emit('open', id), acknowledge: ids => emit('acknowledge', ids) };
        return () => null;
      } };
  `
}
const component = await compileComponent(new URL('../src/views/DashboardView.vue', import.meta.url), replacements)
const fire = (id, cameraId = id + 9) => ({ id, cameraId, type: 'fire', status: 'UNCONFIRMED', alerting: true,
  detectedAt: new Date().toISOString(), confidence: .92 })

async function setup(initial = []) {
  const originals = { document: globalThis.document, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval }
  const intervals = new Map()
  globalThis.setInterval = (callback, delay) => { const key = {}; intervals.set(key, { callback, delay }); return key }
  globalThis.clearInterval = key => intervals.delete(key)
  const state = { cameras: [{ id: 10, name: '청성', sourceType: 'test' }, { id: 11, name: '의성', sourceType: 'test' }],
    events: initial, acks: [], tones: 0, eventReads: 0, refreshes: 0 }
  state.onAck = async id => { state.events = state.events.map(event => event.id === id ? { ...event, status: 'CONFIRMED', alerting: false } : event) }
  globalThis.__dashboardAlertsTest = state
  const harness = createHarness()
  globalThis.document = { hidden: false, body: harness.body }
  const view = harness.mount(component)
  await settle()
  async function poll() { [...intervals.values()].find(timer => timer.delay === 5000).callback(); await settle() }
  return { ...view, state, intervals, poll, dispose() { view.app.unmount(); Object.assign(globalThis, originals); delete globalThis.__dashboardAlertsTest } }
}

test('과거 이벤트에서 Test를 시작해도 카메라는 유지하고 새 실행 이벤트를 상세에 표시한다', async () => {
  const view = await setup([{ ...fire(1, 10), videoId: 7 }])
  try {
    view.state.list.select(1)
    await settle()
    assert.equal(view.state.detail.props.event.id, 1)
    view.state.detail.start({ id: 77, camera_id: 10, video_id: 7 })
    await settle()
    assert.equal(view.state.detail.props.camera.id, 10)
    assert.equal(view.state.detail.props.event, null)
    view.state.events = [{ ...fire(2, 10), videoId: 7 }, ...view.state.events]
    await view.poll()
    assert.equal(view.state.detail.props.event.id, 2)
  } finally { view.dispose() }
})

test('이벤트만 5초마다 갱신해 새 화재를 팝업에 넣고 이미 본 이벤트는 반복 알리지 않는다', async () => {
  const view = await setup([fire(1)])
  try {
    assert.equal(view.state.modal.props.events.length, 0)
    view.state.events = [fire(2), fire(1)]
    await view.poll()
    assert.deepEqual(view.state.modal.props.events.map(event => event.id), [2])
    assert.equal(view.state.tones, 1)
    await view.poll()
    assert.equal(view.state.tones, 1)
    globalThis.document.hidden = true
    const reads = view.state.eventReads
    await view.poll()
    assert.equal(view.state.eventReads, reads)
  } finally { view.dispose() }
  assert.equal(view.intervals.size, 0)
})

test('로그인 없이 확인하고 실패 시 팝업을 유지하며 중복 클릭을 막은 뒤 재시도할 수 있다', async () => {
  const view = await setup()
  try {
    view.state.events = [fire(1)]
    await view.poll()
    let reject
    view.state.onAck = () => new Promise((_resolve, fail) => { reject = fail })
    view.state.modal.acknowledge([1])
    view.state.modal.acknowledge([1])
    await settle()
    assert.deepEqual(view.state.acks, [1])
    assert.equal(view.state.modal.props.busy, true)
    assert.equal(view.state.list.props.ackBusy, true)
    reject(new Error('확인 요청 실패'))
    await settle()
    assert.equal(view.state.modal.props.events.length, 1)
    assert.equal(view.state.modal.props.error, '확인 요청 실패')
    assert.equal(view.state.list.props.events[0].status, 'UNCONFIRMED')
    view.state.onAck = async () => { view.state.events = [{ ...fire(1), status: 'CONFIRMED', alerting: false }] }
    view.state.modal.acknowledge([1])
    await settle()
    assert.deepEqual(view.state.acks, [1, 1])
    assert.equal(view.state.modal.props.events.length, 0)
    assert.equal(view.state.list.props.events[0].status, 'CONFIRMED')
  } finally { view.dispose() }
})

test('여러 이벤트 확인 중 일부만 실패하면 성공한 알림은 제거하고 실패한 알림만 남긴다', async () => {
  const view = await setup()
  try {
    view.state.events = [fire(1), fire(2)]
    await view.poll()
    view.state.onAck = async id => {
      if (id === 2) throw new Error('두 번째 확인 실패')
      view.state.events = view.state.events.map(event => event.id === id ? { ...event, status: 'CONFIRMED', alerting: false } : event)
    }
    view.state.modal.acknowledge([1, 2])
    await settle()
    assert.deepEqual(view.state.modal.props.events.map(event => event.id), [2])
    assert.equal(view.state.modal.props.error, '두 번째 확인 실패')
    assert.equal(view.state.list.props.events.find(event => event.id === 1).status, 'CONFIRMED')
  } finally { view.dispose() }
})

test('다른 화면에서 확인한 이벤트는 다음 갱신 때 팝업에서 제거한다', async () => {
  const view = await setup()
  try {
    view.state.events = [fire(1)]
    await view.poll()
    view.state.events = [{ ...fire(1), status: 'CONFIRMED', alerting: false }]
    await view.poll()
    assert.equal(view.state.modal.props.events.length, 0)
    assert.deepEqual(view.state.acks, [])
  } finally { view.dispose() }
})

test('새 연기는 화재 alerting 값 없이 팝업과 알림음을 표시하고 확인 후 제거한다', async () => {
  const view = await setup()
  try {
    const smoke = { ...fire(1), type: 'smoke', alerting: false }
    view.state.events = [smoke]
    await view.poll()
    assert.deepEqual(view.state.modal.props.events.map(event => event.id), [1])
    assert.equal(view.state.tones, 1)
    await view.poll()
    assert.equal(view.state.tones, 1)
    view.state.modal.acknowledge([1])
    await settle()
    assert.deepEqual(view.state.acks, [1])
    assert.equal(view.state.modal.props.events.length, 0)
  } finally { view.dispose() }
})

test('같은 CCTV의 연기 뒤 화재가 오면 기존 팝업에 합치고 연기 확인은 화재를 지우지 않는다', async () => {
  const view = await setup()
  try {
    view.state.events = [{ ...fire(1, 10), type: 'smoke', alerting: false }]
    await view.poll()
    view.state.events = [fire(2, 10), ...view.state.events]
    await view.poll()
    assert.deepEqual(view.state.modal.props.events.map(event => event.type), ['fire', 'smoke'])
    assert.equal(view.state.tones, 2)
    view.state.modal.acknowledge([1])
    await settle()
    assert.deepEqual(view.state.modal.props.events.map(event => event.id), [2])
    assert.equal(view.state.list.props.events.find(event => event.id === 2).status, 'UNCONFIRMED')
  } finally { view.dispose() }
})

test('지도를 닫은 뒤 팝업에서 지도 보기를 누르면 지도를 다시 열고 확인 상태는 유지한다', async () => {
  const view = await setup()
  try {
    const mapButton = () => findAll(view.root, 'button').find(node => node.props['aria-controls'] === 'monitoring-map')
    mapButton().props.onClick()
    await settle()
    assert.equal(mapButton().props['aria-expanded'], false)
    view.state.events = [{ ...fire(1), type: 'smoke', alerting: false }]
    await view.poll()
    assert.equal(view.state.modal.props.events.length, 1)
    view.state.modal.open(1)
    await settle()
    assert.equal(mapButton().props['aria-expanded'], true)
    assert.equal(view.state.modal.props.events.length, 0)
    assert.deepEqual(view.state.acks, [])
    assert.equal(view.state.list.props.events[0].status, 'UNCONFIRMED')
  } finally { view.dispose() }
})
