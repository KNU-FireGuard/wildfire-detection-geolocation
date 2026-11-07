import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

const read = name => parse(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')).descriptor

test('Test 패널은 로그인 폼 없이 버튼에서 바로 분석을 시작한다', () => {
  const { scriptSetup, template } = read('components/TestRunPanel.vue')
  assert.doesNotMatch(scriptSetup.content, /ensureAdminToken|loginAdmin|useAdminSession/)
  assert.match(template.content, /@click="beginTest"/)
  assert.doesNotMatch(template.content, /test-login|관리자 ID|비밀번호/)
})

test('CCTV 주소 갱신은 공용 관리자 세션의 토큰으로 호출하고 로그인한 뒤에는 입력란을 숨긴다', () => {
  const { scriptSetup, template } = read('views/DashboardView.vue')
  assert.match(scriptSetup.content, /ensureAdminToken\(loginAdmin,/)
  assert.match(scriptSetup.content, /refreshLiveCctvs\(token\)/)
  assert.match(scriptSetup.content, /code === 'unauthorized'[\s\S]*signOut\(\)/)
  assert.match(template.content, /v-if="!isLoggedIn"[^>]*>[\s\S]*?name="username"/)
})
