import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

const { descriptor } = parse(readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8'))
const brand = descriptor.template.content.match(/<RouterLink class="brand"[^>]*>([\s\S]*?)<\/RouterLink>/)?.[1] ?? ''

test('사이드바 상단에는 불꽃 아이콘과 영문 이름 없이 "산불 탐지 관제 시스템"만 표시한다', () => {
  assert.ok(brand.length > 0, '로고 영역을 찾지 못했습니다')
  assert.match(brand, /<strong>산불 탐지 관제 시스템<\/strong>/)
  assert.doesNotMatch(brand, /FireGuard|DashboardIcon|<small>/)
})

test('사이드바가 아이콘으로 접히는 좁은 화면에서는 글자뿐인 로고를 숨긴다', () => {
  const narrow = descriptor.styles[0].content.match(/@media \(max-width: 960px\)\s*\{([\s\S]*?)\}\s*(?=@media|$)/)?.[1] ?? ''
  assert.match(narrow, /\.brand\s*\{[^}]*display:\s*none/)
})
