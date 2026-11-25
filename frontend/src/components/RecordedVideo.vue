<script setup>
import { ref, watch } from 'vue'
const props = defineProps({ videoId: { type: Number, required: true }, sequence: { type: Number, default: 0 } })
const player = ref(null)
function restart() {
  const element = player.value
  if (!element || !element.readyState) return
  element.currentTime = 0
}
watch(() => props.sequence, () => {
  restart()
  player.value?.play()?.catch(() => {})
})
</script>
<template>
  <video :key="videoId" ref="player" :src="`/api/videos/${videoId}/stream`" controls muted autoplay playsinline preload="metadata" aria-label="원본 테스트 영상" @loadedmetadata="restart" />
</template>
<style scoped>video { display: block; width: 100%; max-height: 420px; object-fit: contain; background: #05080c; }</style>
