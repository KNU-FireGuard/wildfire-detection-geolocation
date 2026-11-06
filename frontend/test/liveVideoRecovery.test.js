import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { parse } from '@vue/compiler-sfc'
import { decideRecovery, describeHlsError } from '../src/utils/hlsRecovery.js'
import { trackPlaybackProgress } from '../src/utils/playbackProgress.js'

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
    video: { value: { currentTime: 0 } }, lastTime: 0, retryTimer: null, networkRecoveryKind: null,
    decideRecovery, describeHlsError, trackPlaybackProgress,
    console: { warn() {} },
    setTimeout(callback) { const id = ++nextId; pending.set(id, callback); return id },
    clearTimeout(id) { pending.delete(id) },
  }
  runInNewContext(`${handlers}\nthis.handleHlsError = handleHlsError; this.onPlaying = onPlaying; this.onTimeUpdate = onTimeUpdate; this.onFragmentLoaded = onFragmentLoaded; this.onManifestLoaded = onManifestLoaded; this.onLevelLoaded = onLevelLoaded`, context)
  return { context, pending, player }
}

test('네트워크 오류 후 버퍼 영상만 진행되면 예약된 재연결을 유지한다', () => {
  const { context, pending, player } = setup()
  context.handleHlsError({ fatal: true, type: 'networkError', details: 'manifestLoadError' })
  assert.equal(pending.size, 1)

  context.video.value.currentTime = 1
  context.onTimeUpdate()
  assert.equal(context.playing.value, true)
  assert.equal(pending.size, 1)
  assert.equal(context.retrying.value, 1)
  assert.equal(context.attempts.network, 1)

  context.onPlaying()
  assert.equal(pending.size, 1)
  assert.equal(context.attempts.network, 1)
  assert.equal(player.loadSourceCalls, 0)

  pending.values().next().value()
  assert.equal(player.loadSourceCalls, 1)
})

test('실패한 재생목록 대신 남아 있던 영상 조각만 받으면 재연결을 유지한다', () => {
  const { context, pending, player } = setup()
  context.handleHlsError({ fatal: true, type: 'networkError', details: 'manifestLoadError' })
  context.onPlaying()
  context.onFragmentLoaded()
  assert.equal(pending.size, 1)
  assert.equal(context.retrying.value, 1)
  assert.equal(context.attempts.network, 1)
  assert.equal(player.loadSourceCalls, 0)

  context.onManifestLoaded()
  assert.equal(pending.size, 0)
  assert.equal(context.retrying.value, 0)
  assert.equal(context.attempts.network, 0)
  assert.equal(player.loadSourceCalls, 0)
})

test('실패한 영상 조각을 다시 받으면 예약된 재연결을 취소한다', () => {
  const { context, pending } = setup()
  context.handleHlsError({ fatal: true, type: 'networkError', details: 'fragLoadError' })
  context.onPlaying()
  context.onFragmentLoaded()
  assert.equal(pending.size, 0)
  assert.equal(context.retrying.value, 0)
})

test('재생목록 단계 오류는 해당 단계가 성공할 때까지 다른 성공 이벤트로 해제하지 않는다', () => {
  const { context, pending } = setup()
  context.handleHlsError({ fatal: true, type: 'networkError', details: 'levelLoadError' })
  context.onPlaying()
  context.onFragmentLoaded()
  context.onManifestLoaded()
  assert.equal(pending.size, 1)

  context.onLevelLoaded()
  assert.equal(pending.size, 0)
  assert.equal(context.retrying.value, 0)
})

test('네트워크 재시도 소진 시 CCTV 주소 갱신 안내를 보여 준다', () => {
  const { context } = setup({ network: 3, media: 0 })
  context.handleHlsError({ fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 403 } })
  assert.match(context.error.value, /HTTP 403/)
  assert.match(context.error.value, /CCTV 주소 갱신/)
})

test('재시도 소진 후에는 이전에 예약된 재연결을 실행하지 않는다', () => {
  const { context, pending, player } = setup()
  const detail = { fatal: true, type: 'networkError', details: 'manifestLoadError' }
  for (let attempt = 0; attempt < 3; attempt++) context.handleHlsError(detail)
  assert.equal(pending.size, 1)

  context.handleHlsError(detail)
  assert.match(context.error.value, /CCTV 주소 갱신/)
  assert.equal(pending.size, 0)
  assert.equal(player.loadSourceCalls, 0)
})

test('재생 오류에는 CCTV 주소 갱신을 안내하지 않는다', () => {
  const { context } = setup({ network: 0, media: 2 })
  context.handleHlsError({ fatal: true, type: 'mediaError', details: 'bufferAppendError' })
  assert.match(context.error.value, /재생 오류/)
  assert.doesNotMatch(context.error.value, /CCTV 주소 갱신/)
})
