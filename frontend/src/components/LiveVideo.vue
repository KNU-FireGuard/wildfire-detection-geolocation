<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import Hls from 'hls.js'
import { registerLiveVideo, unregisterLiveVideo } from '../composables/liveVideoRegistry'
import { MAX_NETWORK_RETRIES, decideRecovery, describeHlsError } from '../utils/hlsRecovery'

// cameraId를 주면 지도 아래 CCTV 영상 목록의 이 video 요소를 우측 패널이 공유할 수 있게 등록합니다.
const props = defineProps({
  url: { type: String, required: true },
  cameraId: { type: [Number, String], default: null },
})
const video = ref(null)
const error = ref('')
const playing = ref(false)
const retrying = ref(0)
let player
let retryTimer
const attempts = { network: 0, media: 0 }

function dispose() {
  clearTimeout(retryTimer)
  attempts.network = 0
  attempts.media = 0
  retrying.value = 0
  player?.destroy()
  player = null
  playing.value = false
  if (video.value) {
    video.value.pause()
    video.value.removeAttribute('src')
    video.value.load()
  }
}

// 재생이 시작되면 이전 오류와 재시도 상태를 지웁니다.
function onPlaying() {
  playing.value = true
  error.value = ''
  retrying.value = 0
  attempts.network = 0
  attempts.media = 0
}

function handleHlsError(detail) {
  // 영상 주소 토큰이 남지 않도록 오류 종류와 상태 코드만 기록합니다.
  console.warn('[LiveVideo]', { cameraId: props.cameraId, type: detail.type, details: detail.details, fatal: detail.fatal, status: detail.response?.code })
  if (!detail.fatal) return
  const next = decideRecovery(detail, attempts)
  if (next.action === 'retry') {
    attempts.network += 1
    retrying.value = attempts.network
    clearTimeout(retryTimer)
    // 재생목록 자체를 못 받은 경우에는 startLoad만으로 다시 받지 못하므로 주소를 다시 불러옵니다.
    const reload = /^manifest/.test(detail.details ?? '') ? () => player?.loadSource(props.url) : () => player?.startLoad()
    retryTimer = setTimeout(reload, next.delayMs)
  } else if (next.action === 'recover') {
    attempts.media += 1
    player?.recoverMediaError()
  } else {
    retrying.value = 0
    error.value = `영상 연결에 실패했습니다. (${describeHlsError(detail)})`
  }
}

watch(() => [props.url, video.value], ([url, element]) => {
  dispose()
  error.value = ''
  if (!url || !element) return
  // hls.js(MSE)를 우선 사용: 브라우저 기본 HLS로 받은 교차 출처 영상은 captureStream으로 공유할 수 없음
  if (Hls.isSupported()) {
    player = new Hls({ enableWorker: true, liveSyncDurationCount: 2 })
    player.on(Hls.Events.ERROR, (_event, detail) => handleHlsError(detail))
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
    <video ref="video" autoplay muted playsinline preload="auto" @playing="onPlaying" @waiting="playing = false" @error="playing = false; error = '영상 연결에 실패했습니다. (재생 오류)'">이 브라우저는 영상을 재생할 수 없습니다.</video>
    <p v-if="!playing && !error" class="stream-status" role="status">{{ retrying ? `CCTV 영상 재연결 중… (${retrying}/${MAX_NETWORK_RETRIES})` : 'CCTV 영상 연결 중…' }}</p>
    <p v-if="error && !playing" class="stream-error" role="alert">{{ error }}</p>
    <p v-if="playing && (retrying || error)" class="stream-badge" role="status">{{ retrying ? `연결 끊김 · 재연결 중 (${retrying}/${MAX_NETWORK_RETRIES})` : '연결 끊김 · 영상이 곧 멈출 수 있습니다' }}</p>
  </div>
</template>

<style scoped>
div { position: relative; }
video { display: block; width: 100%; height: auto; aspect-ratio: auto 16 / 9; max-height: 420px; background: #111; }
.stream-status { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: #e8f1fc; background: #111; font-size: 12px; }
.stream-badge { position: absolute; top: 6px; right: 6px; margin: 0; padding: 3px 8px; border-radius: 4px; color: #fff; background: #000b; font-size: 11px; pointer-events: none; }
.stream-error { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; padding: 8px 12px; box-sizing: border-box; color: #fff; background: #111; font-size: 12px; text-align: center; }
</style>
