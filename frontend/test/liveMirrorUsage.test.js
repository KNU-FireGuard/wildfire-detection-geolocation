import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from '@vue/compiler-sfc'

const read = name => parse(readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')).descriptor

test('영상 월의 LiveVideo는 카메라 ID로 자기 video 요소를 등록하고 사라질 때 해제한다', () => {
  const { scriptSetup } = read('components/LiveVideo.vue')
  assert.match(scriptSetup.content, /cameraId:/)
  assert.match(scriptSetup.content, /registerLiveVideo\(/)
  assert.match(scriptSetup.content, /unregisterLiveVideo\(/)
  assert.match(read('components/LiveCctvWall.vue').template.content, /<LiveVideo[^>]*:camera-id="camera\.id"/)
})

test('대시보드의 상세 패널은 영상 월의 영상을 공유하고 다른 화면은 직접 연결한다', () => {
  const detail = read('components/EventDetail.vue')
  assert.match(detail.scriptSetup.content, /mirror:\s*\{\s*type:\s*Boolean/)
  assert.match(detail.template.content, /<template v-if="camera\?\.sourceType === 'live' && camera\.streamUrl">[\s\S]*?<LiveMirror v-if="mirror"[\s\S]*?<LiveVideo v-else/)
  assert.match(read('views/DashboardView.vue').template.content, /<EventDetail[^>]*\smirror[\s>]/)
  assert.doesNotMatch(read('views/EventView.vue').template.content, /mirror/)
})

test('LiveVideo는 hls.js(MSE)를 우선 쓰고 지원하지 않을 때만 브라우저 기본 HLS를 쓴다', () => {
  const script = read('components/LiveVideo.vue').scriptSetup.content
  const hls = script.indexOf('Hls.isSupported()')
  const native = script.indexOf("canPlayType('application/vnd.apple.mpegurl')")
  assert.ok(hls >= 0 && native >= 0 && hls < native, 'hls.js 분기가 기본 HLS 분기보다 먼저여야 합니다')
})

