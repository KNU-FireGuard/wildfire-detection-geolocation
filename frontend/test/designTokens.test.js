import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

const globalCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
const root = globalCss.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''
const tokens = Object.fromEntries([...root.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)].map(match => [match[1], match[2]]))

function luminance(hex) {
  const channel = value => { const c = parseInt(value, 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * channel(hex.slice(1, 3)) + 0.7152 * channel(hex.slice(3, 5)) + 0.0722 * channel(hex.slice(5, 7))
}
const ratio = (foreground, background) => {
  const [a, b] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

test('다크 테마 색상 토큰이 정의되어 있다', () => {
  for (const name of ['bg', 'surface', 'surface-2', 'text', 'text-2', 'text-3', 'accent', 'accent-strong', 'fire', 'ok', 'warn', 'on-accent']) {
    assert.ok(tokens[name], `--${name} 토큰이 없습니다`)
  }
})

test('글자와 강조색은 어두운 면 위에서 읽을 수 있는 대비를 가진다(WCAG AA 이상)', () => {
  const rules = [
    ['text', 'surface', 7], ['text', 'bg', 7], ['text-2', 'surface', 4.5], ['text-2', 'surface-2', 4.5],
    ['text-3', 'surface', 4.5], ['text-3', 'surface-2', 4.5], ['accent', 'surface', 4.5], ['accent', 'surface-2', 4.5],
    ['fire', 'surface', 4.5], ['ok', 'surface', 4.5], ['warn', 'surface', 4.5], ['on-accent', 'accent-strong', 4.5],
  ]
  for (const [foreground, background, minimum] of rules) {
    assert.ok(ratio(tokens[foreground], tokens[background]) >= minimum, `--${foreground} on --${background}: ${ratio(tokens[foreground], tokens[background]).toFixed(2)} < ${minimum}`)
  }
})

test('화면 스타일에 밝은 배경색이 남아 있지 않다', () => {
  const files = [
    '../src/App.vue',
    ...readdirSync(new URL('../src/views', import.meta.url)).map(name => `../src/views/${name}`),
    ...readdirSync(new URL('../src/components', import.meta.url)).filter(name => name !== 'TerrainBackdrop.vue').map(name => `../src/components/${name}`),
  ]
  const offenders = []
  for (const file of files) {
    const { descriptor } = parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
    const css = descriptor.styles.map(style => style.content).join('\n') + (file === '../src/style.css' ? '' : '')
    for (const match of css.matchAll(/background(?:-color)?\s*:\s*(white|#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b)/g)) {
      const value = match[1]
      const hex = value === 'white' ? '#ffffff' : value.length === 4 ? `#${[...value.slice(1)].map(c => c + c).join('')}` : value
      if (luminance(hex) > 0.3) offenders.push(`${file}: ${match[0]}`)
    }
  }
  assert.deepEqual(offenders, [])
})
