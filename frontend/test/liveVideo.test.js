import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

test('실시간 CCTV는 음소거 상태로 자동 재생하고 재생 버튼을 표시하지 않는다', () => {
  const source = readFileSync(new URL('../src/components/LiveVideo.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const video = descriptor.template.content.match(/<video\b([^>]*)>/)?.[1] ?? ''

  assert.match(video, /\bautoplay\b/)
  assert.match(video, /\bmuted\b/)
  assert.match(video, /\bplaysinline\b/)
  assert.doesNotMatch(video, /\bcontrols\b/)
})
