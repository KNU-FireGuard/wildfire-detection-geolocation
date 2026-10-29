<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { fetchTestRunStatus, loginAdmin, openTestRunStream, startTestRun } from '../api/catalog'
import { createMjpegParser } from '../utils/mjpeg'

const props = defineProps({ cameraId: { type: Number, required: true } })
const showLogin = ref(false)
const username = ref('')
const password = ref('')
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

watch(() => props.cameraId, () => { cleanup(); showLogin.value = false })
onBeforeUnmount(cleanup)

async function readStream(url, token, current) {
  const controller = new AbortController()
  streamController = controller
  try {
    const response = await openTestRunStream(url, token, controller.signal)
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
    const token = await loginAdmin(username.value, password.value)
    if (current !== generation || cameraId !== props.cameraId) return
    const run = await startTestRun(cameraId, token)
    if (current !== generation) return
    showLogin.value = false
    status.value = run.status
    void readStream(run.stream_url, token, current)
    timer = setInterval(async () => {
      if (current !== generation) return
      try {
        const result = await fetchTestRunStatus(run.id, token)
        if (current !== generation) return
        status.value = result.status
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
    password.value = ''
    if (current === generation) busy.value = false
  }
}
</script>

<template>
  <section class="test-run" aria-label="카메라 Test 분석">
    <button type="button" class="primary-button" :disabled="busy || status === 'ready' || status === 'running'" :aria-expanded="showLogin" @click="showLogin = !showLogin">Test 분석 시작</button>
    <form v-if="showLogin" class="test-login" @submit.prevent="beginTest">
      <p>이 카메라에 연결된 영상 하나를 AI 분석에 전달합니다.</p>
      <label>관리자 ID <input v-model="username" autocomplete="username" required></label>
      <label>비밀번호 <input v-model="password" type="password" autocomplete="current-password" required></label>
      <button type="submit" class="primary-button" :disabled="busy">{{ busy ? '시작 중…' : '분석 실행' }}</button>
    </form>
    <p v-if="status" role="status">분석 상태: {{ ({ ready: '준비 중', running: '진행 중', completed: '완료', failed: '실패' })[status] }}</p>
    <p v-if="error" class="test-error" role="alert">{{ error }}</p>
    <img v-if="frameUrl" class="test-frame" :src="frameUrl" alt="AI 분석 중인 영상 프레임">
  </section>
</template>

<style scoped>
.test-run { display: grid; gap: 10px; margin: 14px 0; }.test-run > .primary-button { justify-self: start; }.test-run p { margin: 0; color: #64748b; font-size: 12px; }.test-login { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; padding: 12px; border: 1px solid #dce5f0; border-radius: 6px; }.test-login p { width: 100%; }.test-login label { display: grid; gap: 4px; font-size: 12px; }.test-login input { padding: 8px; border: 1px solid #cad8e8; border-radius: 4px; }.test-login .primary-button { padding: 9px 12px; }.test-error { color: #b83535 !important; }.test-frame { display: block; width: 100%; max-height: 420px; object-fit: contain; background: #111; }
</style>
