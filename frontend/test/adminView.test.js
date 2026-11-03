import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('관리자 화면은 /admin 경로와 사이드 메뉴에 연결된다', () => {
  assert.match(read('../src/router.js'), /path:\s*'\/admin',\s*component:\s*AdminView/)
  assert.match(read('../src/App.vue'), /to:\s*'\/admin',\s*label:\s*'관리자'/)
})

test('관리자 화면은 로그인 전에는 로그인 폼만, 로그인 후에 번호 설정과 발송 내역을 보인다', () => {
  const { descriptor } = parse(read('../src/views/AdminView.vue'))
  const template = descriptor.template.content
  const login = template.indexOf('aria-label="관리자 로그인"')
  const phones = template.indexOf('aria-label="카메라별 알림 번호"')
  const logs = template.indexOf('aria-label="문자 발송 내역"')
  assert.ok(login >= 0 && phones > login && logs > phones)
  assert.match(template, /<section v-if="!isLoggedIn"[^>]*aria-label="관리자 로그인"/)
  assert.match(template, /<template v-else>/)
  assert.match(template, /type="password"/)
  assert.match(template, /autocomplete="current-password"/)
})

test('관리자 화면은 API 데이터만 사용하고 mock이나 localStorage에 토큰을 두지 않는다', () => {
  const source = read('../src/views/AdminView.vue') + read('../src/composables/useAdminSession.js')
  assert.match(source, /from '\.\.\/api\/admin'/)
  assert.doesNotMatch(source, /mocks\//)
  assert.doesNotMatch(source, /localStorage|sessionStorage/)
})

test('발송 상태는 sent, failed, skipped를 한국어로 구분한다', () => {
  const { descriptor } = parse(read('../src/views/AdminView.vue'))
  const script = descriptor.scriptSetup.content
  for (const status of ['sent', 'failed', 'skipped']) assert.match(script, new RegExp(`${status}:`))
})
