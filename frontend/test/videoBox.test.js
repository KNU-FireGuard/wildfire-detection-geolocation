import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

const css = name => parse(readFileSync(new URL(`../src/components/${name}`, import.meta.url), 'utf8')).descriptor.styles.map(style => style.content).join('\n')

test('영상 영역은 고정 높이 없이 영상 비율에 맞춰 커져서 영상 아래에 검은 공백이 생기지 않는다', () => {
  const detail = css('EventDetail.vue')
  const boxRules = [...detail.matchAll(/\.video-placeholder\s*\{([^}]*)\}/g)].map(match => match[1]).join(';')
  assert.doesNotMatch(boxRules, /min-height\s*:/)
  assert.doesNotMatch(boxRules, /(?<![-\w])height\s*:/)
  assert.match(detail, /\.video-placeholder video\s*\{[^}]*aspect-ratio/)
})

test('실시간 영상 컴포넌트의 video도 영상 비율을 따르고 불러오는 동안은 16:9로 자리를 잡는다', () => {
  for (const name of ['LiveVideo.vue', 'LiveMirror.vue']) {
    assert.match(css(name), /(^|\n)video\s*\{[^}]*aspect-ratio:\s*auto 16 \/ 9/, name)
    assert.match(css(name), /(^|\n)video\s*\{[^}]*(?<![-\w])height:\s*auto/, name)
  }
})
