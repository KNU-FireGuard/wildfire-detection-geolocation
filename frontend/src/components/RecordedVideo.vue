<script setup>
import { ref, watch } from 'vue'
const props = defineProps({ videoId: { type: Number, required: true }, position: { type: Number, default: 0 }, sequence: { type: Number, default: 0 } })
const player = ref(null)
function seek() {
  const element = player.value
  if (!element || !element.readyState) return
  const target = Math.max(0, props.position)
  element.currentTime = Number.isFinite(element.duration) ? Math.min(target, element.duration) : target
}
watch(() => [props.position, props.sequence], () => {
  seek()
  player.value?.play()?.catch(() => {})
})
</script>
<template>
  <video :key="videoId" ref="player" :src="`/api/videos/${videoId}/stream`" controls muted autoplay playsinline preload="metadata" aria-label="원본 테스트 영상" @loadedmetadata="seek" />
</template>
<style scoped>video { display: block; width: 100%; max-height: 420px; object-fit: contain; background: #05080c; }</style>
