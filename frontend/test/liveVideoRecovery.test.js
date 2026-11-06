import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { parse } from '@vue/compiler-sfc'
import { decideRecovery, describeHlsError } from '../src/utils/hlsRecovery.js'

const source = readFileSync(new URL('../src/components/LiveVideo.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = descriptor.scriptSetup.content
const handlers = script.slice(script.indexOf('function onPlaying()'), script.indexOf('watch(() => [props.url'))

function setup(attempts = { network: 0, media: 0 }) {
  const pending = new Map()
  let nextId = 0
  const player = { loadSourceCalls: 0, loadSource() { this.loadSourceCalls++ }, startLoad() {}, recoverMediaError() {} }
  const context = {
    attempts, player, props: { url: 'https://example.test/live.m3u8', cameraId: 1 },
    playing: { value: false }, error: { value: '' }, retrying: { value: 0 },
    video: { value: { currentTime: 0 } }, lastTime: 0, retryTimer: null,
    decideRecovery, describeHlsError, trackPlaybackProgress: () => ({ lastTime: 0, progressed: false }),
    console: { warn() {} },
    setTimeout(callback) { const id = ++nextId; pending.set(id, callback); return id },
    clearTimeout(id) { pending.delete(id) },
  }
  runInNewContext(`${handlers}\nthis.handleHlsError = handleHlsError; this.onPlaying = onPlaying`, context)
  return { context, pending, player }
}

test('영상이 다시 재생되면 예약된 재연결을 취소한다', () => {
  const { context, pending, player } = setup()
  context.handleHlsError({ fatal: true, type: 'networkError', details: 'manifestLoadError' })
  assert.equal(pending.size, 1)

  context.onPlaying()
  assert.equal(pending.size, 0)
  assert.equal(context.retrying.value, 0)
  assert.equal(player.loadSourceCalls, 0)
})

test('네트워크 재시도 소진 시 CCTV 주소 갱신 안내를 보여 준다', () => {
  const { context } = setup({ network: 3, media: 0 })
  context.handleHlsError({ fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 403 } })
  assert.match(context.error.value, /HTTP 403/)
  assert.match(context.error.value, /CCTV 주소 갱신/)
})

test('재생 오류에는 CCTV 주소 갱신을 안내하지 않는다', () => {
  const { context } = setup({ network: 0, media: 2 })
  context.handleHlsError({ fatal: true, type: 'mediaError', details: 'bufferAppendError' })
  assert.match(context.error.value, /재생 오류/)
  assert.doesNotMatch(context.error.value, /CCTV 주소 갱신/)
})
