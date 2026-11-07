<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { getLiveVideo } from '../composables/liveVideoRegistry'

// captureStream을 지원하지 않는 브라우저에서만 직접 연결합니다.
const LiveVideo = defineAsyncComponent(() => import('./LiveVideo.vue'))

const props = defineProps({
  cameraId: { type: [Number, String], required: true },
  url: { type: String, required: true },
})
const target = ref(null)
const playing = ref(false)
const hasPlayed = ref(false)
const captureFailed = ref(false)
const source = computed(() => getLiveVideo(props.cameraId))
const canCapture = computed(() => typeof source.value?.captureStream === 'function')
let detach = () => {}

watch([target, source], ([element, from]) => {
  detach()
  detach = () => {}
  playing.value = false
  hasPlayed.value = false
  if (!element) return
  if (!from || typeof from.captureStream !== 'function') {
    element.srcObject = null
    return
  }
  // 교차 출처 영상 등으로 공유가 거절되면 직접 연결로 대체합니다.
  const capture = () => {
    try { element.srcObject = from.captureStream() } catch { captureFailed.value = true }
  }
  capture()
  // 지도 아래 실시간 CCTV 영상이 새로 로드되면(주소 갱신 등) 다시 받습니다.
  const recapture = capture
  from.addEventListener?.('loadedmetadata', recapture)
  detach = () => from.removeEventListener?.('loadedmetadata', recapture)
}, { immediate: true, flush: 'post' })

// 실패 상태는 공유할 영상(source)이 바뀔 때만 지웁니다. 영상 요소가 바뀔 때 지우면 실패와 재시도가 무한 반복됩니다.
watch(source, () => { captureFailed.value = false })

onBeforeUnmount(() => {
  detach()
  if (target.value) target.value.srcObject = null
})
</script>

<template>
  <LiveVideo v-if="(source && !canCapture) || captureFailed" :url="url" />
  <div v-else class="mirror">
    <video ref="target" autoplay muted playsinline @playing="playing = true; hasPlayed = true" @waiting="playing = false" />
    <p v-if="!hasPlayed && !playing" class="stream-status" role="status">CCTV 영상 연결 중…</p>
  </div>
</template>

<style scoped>
.mirror { position: relative; }
video { display: block; width: 100%; height: auto; aspect-ratio: auto 16 / 9; max-height: 420px; background: #05080c; }
.stream-status { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: var(--text-2); background: #05080c; font-size: 12px; letter-spacing: 0.2px; }
</style>
