<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import Hls from 'hls.js'
import { registerLiveVideo, unregisterLiveVideo } from '../composables/liveVideoRegistry'

// cameraId를 주면 영상 월에서 이 video 요소를 우측 패널이 공유할 수 있게 등록합니다.
const props = defineProps({
  url: { type: String, required: true },
  cameraId: { type: [Number, String], default: null },
})
const video = ref(null)
const error = ref('')
const playing = ref(false)
let player

function dispose() {
  player?.destroy()
  player = null
  playing.value = false
  if (video.value) {
    video.value.pause()
    video.value.removeAttribute('src')
    video.value.load()
  }
}

watch(() => [props.url, video.value], ([url, element]) => {
  dispose()
  error.value = ''
  if (!url || !element) return
  // hls.js(MSE)를 우선 사용: 브라우저 기본 HLS로 받은 교차 출처 영상은 captureStream으로 공유할 수 없음
  if (Hls.isSupported()) {
    player = new Hls({ enableWorker: true, liveSyncDurationCount: 2 })
    player.on(Hls.Events.ERROR, (_event, detail) => {
      if (detail.fatal) {
        playing.value = false
        error.value = '영상 연결에 실패했습니다. 방송 상태 또는 영상 서버의 CORS 설정을 확인하세요.'
      }
    })
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
    <video ref="video" autoplay muted playsinline preload="auto" @playing="playing = true" @waiting="playing = false" @error="playing = false; error = '영상 연결에 실패했습니다.'">이 브라우저는 영상을 재생할 수 없습니다.</video>
    <p v-if="!playing && !error" class="stream-status" role="status">CCTV 영상 연결 중…</p>
    <p v-if="error" class="stream-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
div { position: relative; }
video { display: block; width: 100%; height: auto; aspect-ratio: auto 16 / 9; max-height: 420px; background: #111; }
.stream-status { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: #e8f1fc; background: #111; font-size: 12px; }
.stream-error { padding: 8px 12px; color: #fff; font-size: 12px; }
</style>
