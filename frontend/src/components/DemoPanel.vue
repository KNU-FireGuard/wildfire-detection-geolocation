<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { startDemo, getDemo } from '../api/workflow'
import { accessToken } from '../auth'
import { createDemoMonitor } from '../demoMonitor'

const props = defineProps({ cameras: { type: Array, default: () => [] }, enabled: Boolean, refreshEvents: { type: Function, required: true } })
const run = ref(null), starting = ref(false), startError = ref(''), pollError = ref('')
const checking = ref(false)
const playback = ref({}), elements = new Map()
let startController, disposed = false
const statusLabels = { running: '분석 중', completed: '분석 완료', completed_with_errors: '일부 분석 실패', failed: '분석 실패' }
const slots = computed(() => run.value?.videos ?? Array.from({ length: 4 }, (_, i) => ({ camera_id: null, video_id: `empty-${i}` })))
const monitor = createDemoMonitor({
  read: async (id, signal) => {
    const result = await getDemo(id, accessToken.value, { signal })
    if (result.cameras.some(camera => !run.value.videos.some(video => video.camera_id === camera.camera_id))) throw new Error('실행 영상과 카메라 상태가 일치하지 않습니다.')
    return result
  },
  update: result => { run.value = { ...run.value, ...result, videos: run.value.videos }; pollError.value = '' },
  refresh: signal => props.refreshEvents(signal),
  error: cause => { pollError.value = cause.message },
})
function cameraStatus(id) { return run.value?.cameras?.find(camera => camera.camera_id === id) }
function cameraName(id, index) { return props.cameras.find(camera => camera.id === id)?.name ?? (id == null ? `영상 ${index + 1}` : `카메라 #${id}`) }
function setVideo(id, element) { if (element) elements.set(id, element); else elements.delete(id) }
function mediaState(id, status) { playback.value = { ...playback.value, [id]: status } }
async function begin() {
  if (!props.enabled || starting.value || checking.value || pollError.value || run.value?.status === 'running') return
  starting.value = true; startError.value = ''; pollError.value = ''
  startController = new AbortController()
  try {
    const result = await startDemo(accessToken.value, { signal: startController.signal })
    if (disposed) return
    monitor.stop()
    // 새 실행마다 네 개 영상 요소를 새로 만들어 처음부터 재생합니다.
    run.value = result; playback.value = {}
    await nextTick()
    if (disposed) return
    const attempts = result.videos.map(async video => {
      const element = elements.get(video.video_id)
      if (!element) return
      mediaState(video.video_id, '재생 준비 중')
      try { await element.play() } catch { if (!disposed) mediaState(video.video_id, '재생 실패: 브라우저 정책 또는 영상 파일을 확인하세요.') }
    })
    // 영상 로딩이 상태 조회를 지연시키지 않도록 독립적으로 처리합니다.
    void Promise.allSettled(attempts)
    void monitor.start(result.id)
  } catch (cause) { if (!disposed) startError.value = cause.message }
  finally { if (!disposed) starting.value = false }
}
async function retry() {
  if (checking.value) return
  checking.value = true; pollError.value = ''
  try { await monitor.start(run.value.id) } finally { if (!disposed) checking.value = false }
}
onBeforeUnmount(() => { disposed = true; startController?.abort(); monitor.stop(); elements.forEach(video => video.pause()) })
</script>

<template>
  <section class="dashboard-panel demo-panel" aria-labelledby="demo-title">
    <div class="demo-heading"><div><h2 id="demo-title">4개 영상 일괄 테스트</h2><p>Test 버튼으로 영상 재생과 분석을 시작합니다. 영상 재생 상태와 AI 분석 상태는 별도로 표시합니다.</p></div><button class="primary-button" :disabled="!enabled || starting || checking || !!pollError || run?.status === 'running'" @click="begin">{{ starting ? '시작 요청 중…' : run?.status === 'running' ? '분석 중' : 'Test' }}</button></div>
    <p v-if="!enabled">개발용 예시 데이터 모드에서는 Test를 실행할 수 없습니다.</p>
    <p v-if="startError" class="error" role="alert">{{ startError }} <RouterLink v-if="!accessToken" to="/login">관리자 로그인</RouterLink></p>
    <div v-if="pollError" class="error" role="alert">상태·이벤트 갱신 실패: {{ pollError }} <button :disabled="checking" @click="retry">상태 조회 다시 시도</button><p>서버의 실행 상태를 확인하기 전에는 새 Test를 요청하지 않습니다.</p></div>
    <p class="run-status" role="status">{{ run ? `실행 #${run.id} · ${statusLabels[run.status]}` : 'Test 시작 대기' }}</p>
    <div class="video-grid">
      <article v-for="(slot, index) in slots" :key="`${run?.id ?? 'idle'}-${slot.video_id}`" class="video-card">
        <h3>{{ cameraName(slot.camera_id, index) }}</h3>
        <video v-if="slot.stream_url" :ref="element => setVideo(slot.video_id, element)" :src="slot.stream_url" muted playsinline disablepictureinpicture disableremoteplayback preload="auto" tabindex="-1" @contextmenu.prevent @playing="mediaState(slot.video_id, '재생 중')" @waiting="mediaState(slot.video_id, '버퍼링 중')" @ended="mediaState(slot.video_id, '재생 완료')" @error="mediaState(slot.video_id, '영상 재생 실패: 파일 또는 연결을 확인하세요.')">영상 재생을 지원하지 않는 브라우저입니다.</video>
        <div v-else class="video-empty">Test 시작 후 영상이 표시됩니다.</div>
        <p>영상: {{ playback[slot.video_id] ?? '대기' }}</p>
        <p>AI: {{ cameraStatus(slot.camera_id) ? statusLabels[cameraStatus(slot.camera_id).status] : run ? '상태 조회 대기' : '대기' }}</p>
        <p v-if="cameraStatus(slot.camera_id)?.error" class="error">{{ cameraStatus(slot.camera_id).error }}</p>
      </article>
    </div>
    <p class="note">분석 상태는 약 2초 간격으로 갱신됩니다. 화면을 떠나도 서버 분석은 계속될 수 있습니다. 탐지 목록은 전체 저장 이벤트이며 현재 실행만의 결과는 아닙니다.</p>
  </section>
</template>

<style scoped>
.demo-panel { margin-bottom: 18px; }.demo-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; }.demo-heading h2 { margin: 0; font-size: 19px; }.demo-heading p, .note { font-size: 12px; color: #65748a; line-height: 1.6; }.demo-heading button { flex-shrink: 0; }.video-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }.video-card { min-width: 0; border: 1px solid #e2e7ef; border-radius: 6px; overflow: hidden; }.video-card h3, .video-card p { margin: 10px 12px; font-size: 13px; }.video-card video, .video-empty { display: block; width: 100%; aspect-ratio: 16 / 9; background: #111c29; color: #c0cedd; object-fit: contain; }.video-empty { display: grid; place-items: center; font-size: 13px; }.error { color: #b93434; overflow-wrap: anywhere; }.run-status { font-weight: 600; font-size: 14px; }button:disabled { cursor: not-allowed; opacity: .6; }@media (max-width: 600px) { .video-grid { grid-template-columns: 1fr; }.demo-heading { align-items: start; } }
</style>
