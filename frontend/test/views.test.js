import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createRouter, createMemoryHistory, RouterLink } from 'vue-router'

test('Vue 화면에 영상 대기 영역 4개와 로그인·수신자 폼이 렌더링된다', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  try {
    const { default: Demo } = await server.ssrLoadModule('/src/components/DemoPanel.vue')
    const demoApp = createSSRApp(Demo, { enabled: true, cameras: [], refreshEvents: async () => {} })
    demoApp.component('RouterLink', RouterLink)
    const demo = await renderToString(demoApp)
    assert.equal((demo.match(/class="video-card"/g) ?? []).length, 4)
    assert.match(demo, /Test 시작 대기/)
    const { default: Login } = await server.ssrLoadModule('/src/views/LoginView.vue')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/login', component: Login }] })
    await router.push('/login')
    const loginApp = createSSRApp(Login)
    loginApp.use(router)
    const login = await renderToString(loginApp)
    assert.match(login, /type="password"/)
    assert.match(login, /관리자 로그인/)
    const { default: Recipients } = await server.ssrLoadModule('/src/views/RecipientsView.vue')
    const recipients = await renderToString(createSSRApp(Recipients))
    assert.match(recipients, /SMS 수신자 관리/)
    assert.match(recipients, /type="tel"/)
    assert.doesNotMatch(recipients, /SMS 테스트 이력/)
  } finally { await server.close() }
})
