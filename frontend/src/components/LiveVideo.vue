<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import Hls from 'hls.js'

const props = defineProps({ url: { type: String, required: true } })
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
  if (element.canPlayType('application/vnd.apple.mpegurl')) element.src = url
  else if (Hls.isSupported()) {
    player = new Hls({ enableWorker: true, liveSyncDurationCount: 2 })
    player.on(Hls.Events.ERROR, (_event, detail) => {
      if (detail.fatal) {
        playing.value = false
        error.value = '영상 연결에 실패했습니다. 방송 상태 또는 영상 서버의 CORS 설정을 확인하세요.'
      }
    })
    player.loadSource(url)
    player.attachMedia(element)
  } else error.value = '이 브라우저는 HLS 영상을 재생할 수 없습니다.'
}, { immediate: true, flush: 'post' })

onBeforeUnmount(dispose)
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
video { display: block; width: 100%; max-height: 420px; background: #111; }
.stream-status { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: #e8f1fc; background: #111; font-size: 12px; }
.stream-error { padding: 8px 12px; color: #fff; font-size: 12px; }
</style>
