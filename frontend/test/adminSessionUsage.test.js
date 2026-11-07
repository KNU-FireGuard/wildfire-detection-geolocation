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

test('대시보드의 이벤트 확인과 CCTV 갱신에는 로그인 폼이나 관리자 세션을 사용하지 않는다', () => {
  const { scriptSetup, template } = read('views/DashboardView.vue')
  assert.doesNotMatch(scriptSetup.content, /ensureAdminToken|loginAdmin|useAdminSession/)
  assert.match(scriptSetup.content, /refreshLiveCctvs\(\)/)
  assert.doesNotMatch(template.content, /관리자 ID|비밀번호|로그인 후 확인/)
})
