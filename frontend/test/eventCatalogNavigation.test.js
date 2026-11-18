import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryHistory, createRouter } from 'vue-router'
import { compileComponent, createHarness, findAll, allText, settle } from './helpers/vueHarness.js'

const api = `data:text/javascript,${encodeURIComponent(`
  export const fetchEvent = async () => ({ id: 9, cameraId: null, type: 'fire', status: 'UNCONFIRMED' });
  export const fetchCameras = async () => [];
`)}`
const detail = await compileComponent(new URL('../src/views/EventView.vue', import.meta.url), {
  "'vue-router'": JSON.stringify(import.meta.resolve('vue-router')),
  "'../api/catalog'": JSON.stringify(api),
  "'../composables/useQuery'": JSON.stringify(new URL('../src/composables/useQuery.js', import.meta.url).href),
  "'../utils/eventFormat'": JSON.stringify(new URL('../src/utils/eventFormat.js', import.meta.url).href),
  "import EventDetail from '../components/EventDetail.vue'": 'const EventDetail = { render: () => null }',
})

test('상세 화면의 목록 복귀 링크는 검색 조건과 페이지를 실제 라우터에 유지한다', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/events', component: { render: () => null } },
    { path: '/events/:id', component: detail },
  ] })
  const query = { q: '청성', type: 'fire', period: 'custom', from: '2026-11-16', to: '2026-11-18', page: '2', pageSize: '50' }
  await router.push({ path: '/events/9', query })
  await router.isReady()
  const view = createHarness().mount(detail, { id: '9' }, {}, [router])
  try {
    await settle()
    const back = findAll(view.root, 'a').find(node => /이벤트 목록/.test(allText(node)))
    assert.ok(back)
    await back.props.onClick({ button: 0, preventDefault() {} })
    await settle()
    assert.equal(router.currentRoute.value.path, '/events')
    assert.deepEqual(router.currentRoute.value.query, query)
  } finally { view.app.unmount() }
})
