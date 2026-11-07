import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

const css = name => parse(readFileSync(new URL(`../src/components/${name}`, import.meta.url), 'utf8')).descriptor.styles.map(style => style.content).join('\n')

test('상세 영상 영역은 고정 높이 없이 기존 영상 비율 설정을 유지한다', () => {
  const detail = css('EventDetail.vue')
  const boxRules = [...detail.matchAll(/\.video-placeholder\s*\{([^}]*)\}/g)].map(match => match[1]).join(';')
  assert.doesNotMatch(boxRules, /min-height\s*:/)
  assert.doesNotMatch(boxRules, /(?<![-\w])height\s*:/)
  assert.match(detail, /\.video-placeholder video, \.video-placeholder \.test-frame\s*\{[^}]*aspect-ratio/)
})

test('실시간 CCTV 타일의 기존 높이와 contain 표시를 유지한다', () => {
  assert.match(css('LiveCctvWall.vue'), /\.live-tile :deep\(video\)\s*\{[^}]*height:\s*160px;[^}]*object-fit:\s*contain/)
})

test('실시간 영상 컴포넌트의 video도 영상 비율을 따르고 불러오는 동안은 16:9로 자리를 잡는다', () => {
  for (const name of ['LiveVideo.vue', 'LiveMirror.vue']) {
    assert.match(css(name), /(^|\n)video\s*\{[^}]*aspect-ratio:\s*auto 16 \/ 9/, name)
    assert.match(css(name), /(^|\n)video\s*\{[^}]*(?<![-\w])height:\s*auto/, name)
  }
})

test('연결 오류 문구는 영상 위에 겹쳐 표시해 타일과 패널의 높이를 바꾸지 않는다', () => {
  assert.match(css('LiveVideo.vue'), /\.stream-error\s*\{[^}]*position:\s*absolute/)
})

