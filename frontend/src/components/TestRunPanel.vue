<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { fetchTestRunStatus, openTestRunStream, startTestRun } from '../api/catalog'
import { createMjpegParser } from '../utils/mjpeg'

const props = defineProps({ cameraId: { type: Number, required: true } })
const emit = defineEmits(['frame', 'events-updated'])
const busy = ref(false)
const status = ref('')
const error = ref('')
const frameUrl = ref('')
let timer
let streamController
let generation = 0

function cleanup() {
  generation++
  clearInterval(timer)
  timer = null
  streamController?.abort()
  streamController = null
  if (frameUrl.value) URL.revokeObjectURL(frameUrl.value)
  frameUrl.value = ''
  status.value = ''
  error.value = ''
  busy.value = false
}

watch(frameUrl, url => emit('frame', url))
watch(() => props.cameraId, cleanup)
onBeforeUnmount(() => { cleanup(); emit('frame', '') })

async function readStream(url, current) {
  const controller = new AbortController()
  streamController = controller
  try {
    const response = await openTestRunStream(url, controller.signal)
    const parser = createMjpegParser(frame => {
      if (current !== generation) return
      const next = URL.createObjectURL(new Blob([frame], { type: 'image/jpeg' }))
      if (frameUrl.value) URL.revokeObjectURL(frameUrl.value)
      frameUrl.value = next
    })
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(value)
    }
  } catch (cause) {
    if (current === generation && !controller.signal.aborted && status.value !== 'completed') error.value = cause.message
  } finally {
    if (streamController === controller) streamController = null
  }
}

async function beginTest() {
  if (busy.value || status.value === 'ready' || status.value === 'running') return
  cleanup()
  const current = generation
  busy.value = true
  const cameraId = props.cameraId
  try {
    const run = await startTestRun(cameraId)
    if (current !== generation || cameraId !== props.cameraId) return
    status.value = run.status
    void readStream(run.stream_url, current)
    timer = setInterval(async () => {
      if (current !== generation) return
      try {
        const result = await fetchTestRunStatus(run.id)
        if (current !== generation) return
        status.value = result.status
        emit('events-updated')
        if (result.status === 'failed') error.value = result.error || 'AI 분석에 실패했습니다.'
        if (result.status === 'failed' || result.status === 'completed') {
          clearInterval(timer)
          timer = null
        }
      } catch (cause) {
        if (current !== generation) return
        error.value = cause.message
        clearInterval(timer)
        timer = null
      }
    }, 2000)
  } catch (cause) {
    if (current === generation) error.value = cause.message
  } finally {
    if (current === generation) busy.value = false
  }
}
</script>

<template>
  <section class="test-run" aria-label="카메라 Test 분석">
    <button type="button" class="primary-button" :disabled="busy || status === 'ready' || status === 'running'" @click="beginTest">{{ busy ? '시작 중…' : 'Test 분석 시작' }}</button>
    <p v-if="status" role="status">분석 상태: {{ ({ ready: '준비 중', running: '진행 중', completed: '완료', failed: '실패' })[status] }}</p>
    <p v-if="error" class="test-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.test-run { display: grid; gap: 10px; margin: 14px 0; }.test-run > .primary-button { justify-self: start; }.test-run p { margin: 0; color: var(--text-2); font-size: 12px; }.test-error { color: var(--fire) !important; }.test-frame { display: block; width: 100%; max-height: 420px; object-fit: contain; background: #05080c; border: 1px solid var(--line); border-radius: 10px; }
</style>
