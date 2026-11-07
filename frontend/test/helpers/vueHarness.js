import { readFileSync } from 'node:fs'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { compileScript, parse } from '@vue/compiler-sfc'

export async function compileComponent(url, replacements = {}) {
  const descriptor = parse(readFileSync(url, 'utf8')).descriptor
  let code = compileScript(descriptor, { id: 'behavior-test', inlineTemplate: true }).content
    .replace(/from ['"]vue['"]/g, `from '${import.meta.resolve('vue')}'`)
  for (const [source, target] of Object.entries(replacements)) code = code.replaceAll(source, target)
  return (await import(`data:text/javascript,${encodeURIComponent(code)}`)).default
}

export const makeNode = (tag, text = '') => ({ tag, text, props: {}, children: [], parent: null,
  style: { overflow: '' }, open: false, showCalls: 0,
  addEventListener() {}, removeEventListener() {},
  getRootNode() { return globalThis.document },
  showModal() { this.open = true; this.showCalls++ }, close() { this.open = false },
})
export const findAll = (node, tag) => [...(node.tag === tag ? [node] : []), ...node.children.flatMap(child => findAll(child, tag))]
export const allText = node => [node.text, ...node.children.map(allText)].join(' ')
export const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick(); await nextTick() }

export function createHarness() {
  const body = makeNode('body')
  const renderer = createRenderer({
    createElement: tag => makeNode(tag), createText: text => makeNode('#text', text),
    createComment: text => makeNode('#comment', text),
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.children = [makeNode('#text', text)] },
    patchProp: (node, key, _old, next) => { node.props[key] = next },
    insert(node, parent, anchor = null) {
      if (node.parent) { const index = node.parent.children.indexOf(node); if (index >= 0) node.parent.children.splice(index, 1) }
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node)
      node.parent = parent
    },
    remove(node) { const index = node.parent?.children.indexOf(node) ?? -1; if (index >= 0) node.parent.children.splice(index, 1); node.parent = null },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    querySelector: selector => selector === 'body' ? body : null,
  })
  function mount(Component, values = {}, handlers = {}) {
    const props = reactive(values)
    const root = makeNode('root')
    const app = renderer.createApp({ render: () => h(Component, { ...props, ...handlers }) })
    app.mount(root)
    return { props, root, app, body }
  }
  return { body, mount }
}
