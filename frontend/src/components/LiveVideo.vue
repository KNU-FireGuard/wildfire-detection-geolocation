<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import Hls from 'hls.js'
import { registerLiveVideo, unregisterLiveVideo } from '../composables/liveVideoRegistry'
import { decideRecovery, describeHlsError } from '../utils/hlsRecovery'
import { trackPlaybackProgress } from '../utils/playbackProgress'

// cameraId를 주면 지도 아래 실시간 CCTV 영상의 이 video 요소를 우측 패널이 공유할 수 있게 등록합니다.
const props = defineProps({
  url: { type: String, required: true },
  cameraId: { type: [Number, String], default: null },
})
const video = ref(null)
const error = ref('')
const playing = ref(false)
const hasPlayed = ref(false)
let player
let retryTimer
let networkRecoveryKind = null
const attempts = { network: 0, media: 0 }
let lastTime = 0

function dispose() {
  clearTimeout(retryTimer)
  retryTimer = null
  networkRecoveryKind = null
  lastTime = 0
  attempts.network = 0
  attempts.media = 0
  player?.destroy()
  player = null
  playing.value = false
  hasPlayed.value = false
  if (video.value) {
    video.value.pause()
    video.value.removeAttribute('src')
    video.value.load()
  }
}

// 버퍼에 남은 영상만 재생될 수 있으므로 네트워크 복구 중에는 재시도를 유지합니다.
function onPlaying() {
  playing.value = true
  hasPlayed.value = true
  if (networkRecoveryKind) return
  clearTimeout(retryTimer)
  retryTimer = null
  error.value = ''
  attempts.network = 0
  attempts.media = 0
}

function confirmNetworkRecovery(kind) {
  if (networkRecoveryKind !== kind) return
  networkRecoveryKind = null
  clearTimeout(retryTimer)
  retryTimer = null
  if (playing.value) onPlaying()
}

function onManifestLoaded() { confirmNetworkRecovery('manifest') }
function onLevelLoaded() { confirmNetworkRecovery('level') }
function onFragmentLoaded() { confirmNetworkRecovery('fragment') }

// playing 이벤트가 오지 않아도 재생 시각이 앞으로 가면 영상이 실제로 흐르는 중이므로 연결 중·재연결 문구를 지웁니다.
function onTimeUpdate() {
  const time = video.value?.currentTime ?? 0
  const progress = trackPlaybackProgress(lastTime, time)
  lastTime = progress.lastTime
  if (progress.progressed && !playing.value) onPlaying()
}

function handleHlsError(detail) {
  if (!detail.fatal) return
  // 영상 주소 토큰이 남지 않도록 오류 종류와 상태 코드만, 치명적 오류에서만 기록합니다.
  console.warn('[LiveVideo]', { cameraId: props.cameraId, type: detail.type, details: detail.details, fatal: detail.fatal, status: detail.response?.code })
  const next = decideRecovery(detail, attempts)
  const recoveryKind = /^manifest/.test(detail.details ?? '') ? 'manifest' : /^level/.test(detail.details ?? '') ? 'level' : 'fragment'
  if (next.action === 'retry') {
    networkRecoveryKind = recoveryKind
    attempts.network += 1
    clearTimeout(retryTimer)
    // 재생목록 자체를 못 받은 경우에는 startLoad만으로 다시 받지 못하므로 주소를 다시 불러옵니다.
    const reload = /^manifest/.test(detail.details ?? '') ? () => player?.loadSource(props.url) : () => player?.startLoad()
    retryTimer = setTimeout(() => {
      retryTimer = null
      reload()
    }, next.delayMs)
  } else if (next.action === 'recover') {
    attempts.media += 1
    player?.recoverMediaError()
  } else {
    clearTimeout(retryTimer)
    retryTimer = null
    if (detail.type === 'networkError') networkRecoveryKind = recoveryKind
    const guidance = detail.type === 'networkError' ? ' 계속 실패하면 CCTV 주소 갱신을 시도하세요.' : ''
    error.value = `영상 연결에 실패했습니다. (${describeHlsError(detail)})${guidance}`
  }
}

watch(() => [props.url, video.value], ([url, element]) => {
  dispose()
  error.value = ''
  if (!url || !element) return
  // hls.js(MSE)를 우선 사용: 브라우저 기본 HLS로 받은 교차 출처 영상은 captureStream으로 공유할 수 없음
  if (Hls.isSupported()) {
    player = new Hls({ enableWorker: true, liveSyncDurationCount: 3 })
    player.on(Hls.Events.ERROR, (_event, detail) => handleHlsError(detail))
    player.on(Hls.Events.MANIFEST_LOADED, onManifestLoaded)
    player.on(Hls.Events.LEVEL_LOADED, onLevelLoaded)
    player.on(Hls.Events.FRAG_LOADED, onFragmentLoaded)
    player.loadSource(url)
    player.attachMedia(element)
  } else if (element.canPlayType('application/vnd.apple.mpegurl')) element.src = url
  else error.value = '이 브라우저는 HLS 영상을 재생할 수 없습니다.'
}, { immediate: true, flush: 'post' })

watch([() => props.cameraId, video], ([id, element], [previousId, previousElement] = []) => {
  if (previousId != null && previousElement) unregisterLiveVideo(previousId, previousElement)
  if (id != null && element) registerLiveVideo(id, element)
}, { immediate: true, flush: 'post' })

onBeforeUnmount(() => {
  if (props.cameraId != null && video.value) unregisterLiveVideo(props.cameraId, video.value)
  dispose()
})
</script>

<template>
  <div>
    <video ref="video" autoplay muted playsinline preload="auto" @playing="onPlaying" @timeupdate="onTimeUpdate" @waiting="playing = false" @error="playing = false; error = '영상 연결에 실패했습니다. (재생 오류)'">이 브라우저는 영상을 재생할 수 없습니다.</video>
    <p v-if="!hasPlayed && !playing && !error" class="stream-status" role="status">CCTV 영상 연결 중…</p>
    <p v-if="error && !playing" class="stream-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
div { position: relative; }
video { display: block; width: 100%; height: auto; aspect-ratio: auto 16 / 9; max-height: 420px; background: #05080c; }
.stream-status { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--text-2); background: #05080c; font-size: 12px; letter-spacing: 0.2px; }
.stream-error { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 8px 12px; box-sizing: border-box; color: var(--fire); background: #05080c; font-size: 12px; text-align: center; }
</style>
