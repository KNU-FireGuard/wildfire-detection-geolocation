<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import Hls from 'hls.js'

const props = defineProps({ url: { type: String, required: true } })
const video = ref(null)
const error = ref('')
let player

function dispose() {
  player?.destroy()
  player = null
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
    player = new Hls({ enableWorker: true })
    player.on(Hls.Events.ERROR, (_event, detail) => {
      if (detail.fatal) error.value = '영상 연결에 실패했습니다. 방송 상태 또는 영상 서버의 CORS 설정을 확인하세요.'
    })
    player.loadSource(url)
    player.attachMedia(element)
  } else error.value = '이 브라우저는 HLS 영상을 재생할 수 없습니다.'
}, { immediate: true, flush: 'post' })

onBeforeUnmount(dispose)
</script>

<template>
  <div>
    <video ref="video" autoplay muted playsinline preload="auto" @error="error = '영상 연결에 실패했습니다.'">이 브라우저는 영상을 재생할 수 없습니다.</video>
    <p v-if="error" class="stream-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
video { display: block; width: 100%; max-height: 420px; background: #111; }
.stream-error { padding: 8px 12px; color: #fff; font-size: 12px; }
</style>
