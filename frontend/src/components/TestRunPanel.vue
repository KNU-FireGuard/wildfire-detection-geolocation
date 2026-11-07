<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { fetchTestRunStatus, startTestRun } from '../api/catalog'

const props = defineProps({ cameraId: { type: Number, required: true } })
const emit = defineEmits(['started', 'events-updated'])
const busy = ref(false)
const status = ref('')
const error = ref('')
let timer
let generation = 0

function cleanup() {
  generation++
  clearInterval(timer)
  timer = null
  status.value = ''
  error.value = ''
  busy.value = false
}

watch(() => props.cameraId, cleanup)
onBeforeUnmount(cleanup)

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
    emit('started', run)
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
    <p>원본 영상은 별도로 재생되며 확정 탐지는 캡처로 기록됩니다. 분석 진행은 영상 재생·일시정지와 독립적입니다.</p>
  </section>
</template>

<style scoped>
.test-run { display: grid; gap: 10px; margin: 14px 0; }.test-run > .primary-button { justify-self: start; }.test-run p { margin: 0; color: var(--text-2); font-size: 12px; }.test-error { color: var(--fire) !important; }.test-frame { display: block; width: 100%; max-height: 420px; object-fit: contain; background: #05080c; border: 1px solid var(--line); border-radius: 10px; }
</style>
