import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRenderer, h, nextTick } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'
import { registerLiveVideo, unregisterLiveVideo } from '../src/composables/liveVideoRegistry.js'

const source = readFileSync(new URL('../src/components/LiveMirror.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const vueUrl = import.meta.resolve('vue')
const registryUrl = new URL('../src/composables/liveVideoRegistry.js', import.meta.url).href
const compiled = compileScript(descriptor, { id: 'live-mirror-test', inlineTemplate: true }).content
  .replaceAll("import('./LiveVideo.vue')", "Promise.resolve({ render: () => createVNode('section', { 'data-fallback': 'direct' }) })")
  .replaceAll("'../composables/liveVideoRegistry'", `'${registryUrl}'`)
  .replace(/from ['"]vue['"]/g, `from '${vueUrl}'`)
const { default: LiveMirror } = await import(`data:text/javascript,${encodeURIComponent(`import { createVNode } from '${vueUrl}';\n${compiled}`)}`)

function makeNode(tag, text = '') {
  return { tag, text, props: {}, children: [], parent: null, srcObject: null }
}
const renderer = createRenderer({
  createElement: tag => makeNode(tag),
  createText: text => makeNode('#text', text),
  createComment: text => makeNode('#comment', text),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.children = [makeNode('#text', text)] },
  patchProp: (node, key, _previous, next) => { node.props[key] = next },
  insert(node, parent, anchor = null) {
    if (node.parent) { const i = node.parent.children.indexOf(node); if (i >= 0) node.parent.children.splice(i, 1) }
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node)
    node.parent = parent
  },
  remove(node) { const i = node.parent?.children.indexOf(node) ?? -1; if (i >= 0) node.parent.children.splice(i, 1); node.parent = null },
  parentNode: node => node.parent,
  nextSibling: node => node.parent ? node.parent.children[node.parent.children.indexOf(node) + 1] ?? null : null,
})
const findAll = (node, tag) => [...(node.tag === tag ? [node] : []), ...node.children.flatMap(child => findAll(child, tag))]
const allText = node => [node.tag === '#text' ? node.text : '', ...node.children.map(allText)].join(' ')
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); await nextTick() }

function mount(props) {
  const root = makeNode('root')
  const app = renderer.createApp({ render: () => h(LiveMirror, props) })
  app.mount(root)
  return { root, app }
}

test('영상 월의 같은 영상을 captureStream으로 받아 보여 주고 영상 서버에 다시 접속하지 않는다', async () => {
  const stream = { name: 'captured' }
  const tile = { captureStream: () => stream }
  registerLiveVideo(10, tile)
  const { root, app } = mount({ cameraId: 10, url: 'https://example.test/10.m3u8' })
  await settle()
  const [video] = findAll(root, 'video')
  assert.equal(video.srcObject, stream)
  assert.equal(findAll(root, 'section').length, 0)
  app.unmount()
  assert.equal(video.srcObject, null)
  unregisterLiveVideo(10, tile)
})

test('영상 월의 재생이 아직 준비되지 않았으면 안내하고 준비되면 자동으로 연결한다', async () => {
  const { root, app } = mount({ cameraId: 11, url: 'https://example.test/11.m3u8' })
  await settle()
  assert.match(allText(root), /CCTV 영상 연결 중/)
  assert.doesNotMatch(allText(root), /영상 월/)
  assert.equal(findAll(root, 'video')[0].srcObject, null)
  const stream = { name: 'late' }
  const tile = { captureStream: () => stream }
  registerLiveVideo(11, tile)
  await settle()
  assert.equal(findAll(root, 'video')[0].srcObject, stream)
  app.unmount()
  unregisterLiveVideo(11, tile)
})

test('captureStream을 지원하지 않는 브라우저에서는 직접 연결로 대체한다', async () => {
  const tile = {}
  registerLiveVideo(12, tile)
  const { root, app } = mount({ cameraId: 12, url: 'https://example.test/12.m3u8' })
  await settle()
  assert.equal(findAll(root, 'section').length, 1)
  app.unmount()
  unregisterLiveVideo(12, tile)
})

test('captureStream이 보안 오류로 거절되면 직접 연결로 대체한다', async () => {
  const tile = { captureStream: () => { throw new Error('SecurityError: cross-origin data') } }
  registerLiveVideo(13, tile)
  const { root, app } = mount({ cameraId: 13, url: 'https://example.test/13.m3u8' })
  await settle()
  assert.equal(findAll(root, 'section').length, 1)
  app.unmount()
  unregisterLiveVideo(13, tile)
})

test('영상을 받아 오는 동안에도 사용자에게 내부 용어 대신 같은 안내 문구를 보여 준다', async () => {
  const tile = { captureStream: () => ({ name: 'pending' }) }
  registerLiveVideo(14, tile)
  const { root, app } = mount({ cameraId: 14, url: 'https://example.test/14.m3u8' })
  await settle()
  assert.match(allText(root), /CCTV 영상 연결 중/)
  assert.doesNotMatch(allText(root), /영상 월/)
  app.unmount()
  unregisterLiveVideo(14, tile)
})

test('한 번 재생된 확대 영상은 일시적으로 기다려도 연결 안내로 덮지 않는다', async () => {
  const tile = { captureStream: () => ({ name: 'live' }) }
  registerLiveVideo(15, tile)
  const { root, app } = mount({ cameraId: 15, url: 'https://example.test/15.m3u8' })
  await settle()
  const [video] = findAll(root, 'video')
  video.props.onPlaying()
  await nextTick()
  video.props.onWaiting()
  await nextTick()
  assert.doesNotMatch(allText(root), /CCTV 영상 연결 중/)
  app.unmount()
  unregisterLiveVideo(15, tile)
})

