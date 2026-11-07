import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileComponent, createHarness, findAll, allText, settle } from './helpers/vueHarness.js'

const url = new URL('../src/components/DetectionAlertModal.vue', import.meta.url)
const replacements = {
  "import DashboardIcon from './DashboardIcon.vue'": 'const DashboardIcon = { render: () => null }',
  "'../utils/cameraName'": `'${new URL('../src/utils/cameraName.js', import.meta.url).href}'`,
  "'../utils/eventFormat'": `'${new URL('../src/utils/eventFormat.js', import.meta.url).href}'`,
}
const cameras = [{ id: 10, name: '청성 CCTV' }, { id: 11, name: '의성 CCTV' }]
const fire = id => ({ id, type: 'fire', cameraId: id === 1 ? 10 : 11, detectedAt: '2026-11-07T01:00:00Z', confidence: .92 })

async function setup(events = [], handlers = {}) {
  const harness = createHarness()
  const previousDocument = globalThis.document
  globalThis.document = { body: harness.body }
  const component = await compileComponent(url, replacements)
  const mounted = harness.mount(component, { events, cameras, busy: false, error: '' }, handlers)
  await settle()
  return { ...mounted, dispose() { mounted.app.unmount(); globalThis.document = previousDocument } }
}
const button = (body, text) => findAll(body, 'button').find(node => allText(node).includes(text))

test('연기만 탐지되면 연기 문구와 유형을 표시하고 같은 확인 동작을 제공한다', async () => {
  let ids
  const view = await setup([{ ...fire(1), type: 'smoke' }], { onAcknowledge: value => { ids = value } })
  try {
    assert.equal(findAll(view.body, 'dialog')[0].open, true)
    assert.equal(allText(findAll(view.body, 'h2')[0]).trim(), '연기가 감지되었습니다')
    assert.match(allText(view.body), /새 연기 알림/)
    assert.ok(findAll(view.body, 'span').some(node => node.props.class?.includes('event-type') && allText(node).includes('연기')))
    button(view.body, '확인 완료').props.onClick()
    assert.deepEqual(ids, [1])
  } finally { view.dispose() }
})

test('연기 팝업에 화재가 추가되면 두 유형을 구분하고 다시 열지 않고 모두 확인한다', async () => {
  let ids
  const view = await setup([{ ...fire(1), type: 'smoke' }], { onAcknowledge: value => { ids = value } })
  try {
    view.props.events = [fire(2), { ...fire(1), type: 'smoke' }]
    await settle()
    assert.equal(findAll(view.body, 'dialog')[0].showCalls, 1)
    assert.equal(allText(findAll(view.body, 'h2')[0]).trim(), '화재와 연기가 감지되었습니다')
    button(view.body, '전체 2건 확인').props.onClick()
    assert.deepEqual(ids, [2, 1])
  } finally { view.dispose() }
})

test('새 화재가 들어오면 화면 위 모달을 열고 카메라·시각·신뢰도와 행동 버튼을 표시한다', async () => {
  const view = await setup()
  try {
    const [dialog] = findAll(view.body, 'dialog')
    assert.equal(dialog.open, false)
    view.props.events = [fire(1)]
    await settle()
    assert.equal(dialog.open, true)
    assert.equal(dialog.props.role, 'alertdialog')
    assert.match(allText(view.body), /청성 CCTV/)
    assert.match(allText(view.body), /92/)
    assert.ok(button(view.body, '지도에서 보기'))
    assert.ok(button(view.body, '확인 완료'))
    assert.equal(view.body.style.overflow, 'hidden')
  } finally { view.dispose() }
})

test('열린 팝업에 새 화재를 추가해도 다시 열거나 닫지 않고 전체 확인 대상을 갱신한다', async () => {
  let ids
  const view = await setup([fire(1)], { onAcknowledge: value => { ids = value } })
  try {
    const [dialog] = findAll(view.body, 'dialog')
    view.props.events = [fire(2), fire(1)]
    await settle()
    assert.equal(dialog.showCalls, 1)
    assert.match(allText(view.body), /청성 CCTV/)
    assert.match(allText(view.body), /의성 CCTV/)
    button(view.body, '전체 2건 확인').props.onClick()
    assert.deepEqual(ids, [2, 1])
  } finally { view.dispose() }
})

test('나중에 확인과 Esc는 확인 API 대신 닫기만 요청하고 빈 대기가 되면 스크롤을 복원한다', async () => {
  let dismissed = 0, acknowledged = 0
  const view = await setup([fire(1)], { onDismiss: () => { dismissed++ }, onAcknowledge: () => { acknowledged++ } })
  try {
    button(view.body, '나중에 확인').props.onClick()
    const [dialog] = findAll(view.body, 'dialog')
    let prevented = false
    dialog.props.onCancel({ preventDefault() { prevented = true } })
    assert.equal(prevented, true)
    assert.equal(dismissed, 2)
    assert.equal(acknowledged, 0)
    view.props.events = []
    await settle()
    assert.equal(dialog.open, false)
    assert.equal(view.body.style.overflow, '')
  } finally { view.dispose() }
})

test('확인 중에는 중복 동작과 Esc 닫기를 막고 실패 안내는 같은 팝업에 표시한다', async () => {
  let dismissed = 0
  const view = await setup([fire(1)], { onDismiss: () => { dismissed++ } })
  try {
    view.props.busy = true
    await settle()
    const [dialog] = findAll(view.body, 'dialog')
    assert.ok(findAll(view.body, 'button').every(node => node.props.disabled === true))
    dialog.props.onCancel({ preventDefault() {} })
    assert.equal(dismissed, 0)
    view.props.busy = false
    view.props.error = '확인에 실패했습니다. 다시 시도해주세요.'
    await settle()
    assert.equal(dialog.open, true)
    assert.match(allText(view.body), /확인에 실패했습니다/)
    assert.ok(button(view.body, '확인 완료'))
  } finally { view.dispose() }
})

test('지도에서 보기는 이벤트 ID를 전달하고 확인 처리를 하지 않는다', async () => {
  let opened, acknowledged = 0
  const view = await setup([fire(1)], { onOpen: id => { opened = id }, onAcknowledge: () => { acknowledged++ } })
  try {
    button(view.body, '지도에서 보기').props.onClick()
    assert.equal(opened, 1)
    assert.equal(acknowledged, 0)
  } finally { view.dispose() }
})
