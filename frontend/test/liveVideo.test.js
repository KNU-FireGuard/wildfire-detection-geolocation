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

test('재생을 시작하거나 버퍼링할 때 연결 상태를 바꾼다', () => {
  const source = readFileSync(new URL('../src/components/LiveVideo.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  assert.match(descriptor.template.content, /@playing="onPlaying"/)
  assert.match(descriptor.template.content, /@waiting="playing = false"/)
  assert.match(descriptor.template.content, /v-if="!playing && !error"[^>]*role="status"/)
})

test('재생이 시작되면 이전 오류를 지우고 재생 중인 영상은 오류 표시가 가리지 않는다', () => {
  const { descriptor } = parse(readFileSync(new URL('../src/components/LiveVideo.vue', import.meta.url), 'utf8'))
  assert.match(descriptor.scriptSetup.content, /function onPlaying\(\) \{[^}]*error\.value = ''/)
  assert.match(descriptor.template.content, /v-if="error && !playing"[^>]*role="alert"/)
})

test('치명적 오류는 자동 복구를 시도하고 실제 원인을 표시하며 잘못된 CORS 안내는 쓰지 않는다', () => {
  const { descriptor } = parse(readFileSync(new URL('../src/components/LiveVideo.vue', import.meta.url), 'utf8'))
  const script = descriptor.scriptSetup.content
  assert.match(script, /decideRecovery\(/)
  assert.match(script, /describeHlsError\(/)
  assert.match(script, /\.startLoad\(\)/)
  assert.match(script, /\.recoverMediaError\(\)/)
  // 재생목록 자체를 못 받은 오류는 startLoad만으로 다시 받지 못하므로 주소를 다시 불러와야 함
  assert.match(script, /\^manifest\/\.test\([^)]*\)[\s\S]*loadSource\(props\.url\)/)
  assert.match(script, /console\.warn\('\[LiveVideo\]'/)
  assert.doesNotMatch(script, /CORS 설정을 확인하세요/)
})

test('연결 오류가 나도 영상이 실제로 재생 중이면 영상을 가리지 않고 모서리 알림만 표시한다', () => {
  const { descriptor } = parse(readFileSync(new URL('../src/components/LiveVideo.vue', import.meta.url), 'utf8'))
  const script = descriptor.scriptSetup.content
  const handler = script.slice(script.indexOf('function handleHlsError'), script.indexOf('watch(() => [props.url'))
  assert.ok(handler.length > 100, 'handleHlsError를 찾지 못했습니다')
  // 재생 여부는 영상 이벤트(playing·waiting)로만 정하고 오류 처리에서 바꾸지 않음
  assert.doesNotMatch(handler, /playing\.value\s*=/)
  const template = descriptor.template.content
  assert.match(template, /v-if="playing && \(retrying \|\| error\)"[^>]*class="stream-badge"/)
  assert.match(template, /v-if="error && !playing"[^>]*class="stream-error"/)
  assert.match(descriptor.styles[0].content, /\.stream-badge\s*\{[^}]*position:\s*absolute/)
})

test('오류 기록은 치명적 오류에서만 남겨 일시적 경고로 콘솔이 넘치지 않게 한다', () => {
  const { descriptor } = parse(readFileSync(new URL('../src/components/LiveVideo.vue', import.meta.url), 'utf8'))
  const script = descriptor.scriptSetup.content
  assert.match(script, /if \(!detail\.fatal\) return[\s\S]*console\.warn\('\[LiveVideo\]'/)
})


test('영상 프레임이 실제로 진행되면 재생 중으로 보고 연결 중 문구를 지운다', () => {
  const { descriptor } = parse(readFileSync(new URL('../src/components/LiveVideo.vue', import.meta.url), 'utf8'))
  const script = descriptor.scriptSetup.content
  // playing 이벤트가 오지 않아도 재생 시각이 앞으로 가면 재생 중
  assert.match(descriptor.template.content, /@timeupdate="onTimeUpdate"/)
  assert.match(script, /function onTimeUpdate\(\) \{[\s\S]*currentTime[\s\S]*onPlaying\(\)/)
  // 주소가 바뀌면 이전 재생 시각을 버려야 새 영상의 첫 프레임을 인식함
  const dispose = script.slice(script.indexOf('function dispose'), script.indexOf('function onPlaying'))
  assert.match(dispose, /lastTime\s*=\s*0/)
})
