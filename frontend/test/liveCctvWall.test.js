import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRenderer, h, nextTick, ref } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'

const source = readFileSync(new URL('../src/components/LiveCctvWall.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const vueUrl = import.meta.resolve('vue')
const compiled = compileScript(descriptor, { id: 'live-wall-test', inlineTemplate: true }).content
  .replaceAll("import('./LiveVideo.vue')", "Promise.resolve({ render: () => createVNode('video') })")
  .replace(/from ['"]vue['"]/g, `from '${vueUrl}'`)
const { default: LiveCctvWall } = await import(`data:text/javascript,${encodeURIComponent(`import { createVNode } from '${vueUrl}';\n${compiled}`)}`)

function makeNode(tag, text = '') {
  return {
    tag, text, props: {}, children: [], parent: null,
    canPlayType: () => 'maybe', pause() {}, removeAttribute() {}, load() {},
  }
}

const renderer = createRenderer({
  createElement: tag => makeNode(tag),
  createText: text => makeNode('#text', text),
  createComment: text => makeNode('#comment', text),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.children = [makeNode('#text', text)] },
  patchProp: (node, key, _previous, next) => { node.props[key] = next },
  insert(node, parent, anchor = null) {
    if (node.parent) {
      const oldIndex = node.parent.children.indexOf(node)
      if (oldIndex >= 0) node.parent.children.splice(oldIndex, 1)
    }
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
    node.parent = parent
  },
  remove(node) {
    const index = node.parent?.children.indexOf(node) ?? -1
    if (index >= 0) node.parent.children.splice(index, 1)
    node.parent = null
  },
  parentNode: node => node.parent,
  nextSibling: node => {
    if (!node.parent) return null
    return node.parent.children[node.parent.children.indexOf(node) + 1] ?? null
  },
})

function findAll(node, tag) {
  return [ ...(node.tag === tag ? [node] : []), ...node.children.flatMap(child => findAll(child, tag)) ]
}

test('선택을 바꾸어도 이미 연결된 CCTV 영상 노드를 재생성하지 않는다', async () => {
  const selected = ref(null)
  const cameras = [
    { id: 1, name: '첫 번째 CCTV', streamUrl: 'https://example.test/1.m3u8' },
    { id: 2, name: '두 번째 CCTV', streamUrl: 'https://example.test/2.m3u8' },
  ]
  const root = makeNode('root')
  const app = renderer.createApp({ render: () => h(LiveCctvWall, { cameras, selectedId: selected.value }) })
  app.mount(root)
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  const originalVideos = findAll(root, 'video')
  assert.equal(originalVideos.length, 2)

  selected.value = 2
  await nextTick()
  assert.deepEqual(findAll(root, 'video'), originalVideos)

  selected.value = 1
  await nextTick()
  assert.deepEqual(findAll(root, 'video'), originalVideos)
  app.unmount()
})

function allText(node) {
  return [node.tag === '#text' ? node.text : '', ...node.children.map(allText)].join(' ')
}

test('영상 주소가 없는 실시간 CCTV도 타일에 표시하고 갱신 안내를 보여 준다', async () => {
  const cameras = [
    { id: 1, name: '주소 있는 CCTV', streamUrl: 'https://example.test/1.m3u8' },
    { id: 2, name: '주소 없는 CCTV', streamUrl: null },
  ]
  const root = makeNode('root')
  const app = renderer.createApp({ render: () => h(LiveCctvWall, { cameras, selectedId: null }) })
  app.mount(root)
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  assert.equal(findAll(root, 'video').length, 1)
  const text = allText(root)
  assert.match(text, /주소 없는 CCTV/)
  assert.match(text, /영상 주소가 없습니다/)
  app.unmount()
})
