<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { fetchCameras, fetchEvents, fetchEvent, fetchVideos, fetchLiveMonitorStatus, deleteEvent } from '../api/catalog'
import RecordDialog from '../components/RecordDialog.vue'
import EventCaptures from '../components/EventCaptures.vue'
import RecordedVideo from '../components/RecordedVideo.vue'
import { errorRangeDisplay } from '../maps/naverScene'
import { filterCameras } from '../utils/cameraSearch'
import { cameraName } from '../utils/cameraName'
import { formatDetectedAt, formatType, formatStatus } from '../utils/eventFormat'
import { useQuery } from '../composables/useQuery'
const props = defineProps({ resource: { type: String, required: true } })
const titles = { cameras: '카메라 목록', events: '탐지 이벤트' }
async function fetchEventsWithCameraNames({ signal }) {
  const [events, cameras] = await Promise.all([fetchEvents({ signal }), fetchCameras({ signal })])
  return events.map(event => ({ ...event, cameraName: cameraName(event.cameraId, cameras) }))
}
const loaders = { cameras: fetchCameras, events: fetchEventsWithCameraNames }
const title = computed(() => titles[props.resource])
const { data, loading, error, reload } = useQuery(() => props.resource, signal => loaders[props.resource]({ signal }))
const search = ref('')
const allRows = computed(() => data.value ?? [])
const rows = computed(() => props.resource === 'cameras' ? filterCameras(allRows.value, search.value) : allRows.value)
const selectedCamera = ref(null)
const selectedEvent = ref(null)
const deleting = ref(false)
const deleteError = ref('')
const deleteMessage = ref('')
const checkedIds = ref(new Set())
const deleteProgress = ref(0)
const deleteTotal = ref(0)
let actionGeneration = 0
const allChecked = computed(() => rows.value.length > 0 && rows.value.every(row => checkedIds.value.has(row.id)))
function checkEvent(id, checked) {
  const next = new Set(checkedIds.value)
  if (checked) next.add(id)
  else next.delete(id)
  checkedIds.value = next
}
function checkAll(checked) { checkedIds.value = checked ? new Set(rows.value.map(row => row.id)) : new Set() }
watch(rows, current => {
  const available = new Set(current.map(row => row.id))
  checkedIds.value = new Set([...checkedIds.value].filter(id => available.has(id)))
})
function openCamera(camera) { selectedCamera.value = camera }
function openEvent(event) { if (!deleting.value) selectedEvent.value = event }
async function removeCheckedEvents() {
  if (!checkedIds.value.size || deleting.value) return
  const ids = [...checkedIds.value]
  if (!window.confirm(`선택한 이벤트 ${ids.length}건과 연결된 캡처를 삭제할까요? 문자 발송 이력은 보존됩니다.`)) return
  const generation = actionGeneration
  deleting.value = true
  deleteError.value = ''
  deleteMessage.value = ''
  deleteProgress.value = 0
  deleteTotal.value = ids.length
  const removed = new Set()
  const failures = []
  try {
    for (const id of ids) {
      if (generation !== actionGeneration) break
      try { await deleteEvent(id); removed.add(id) }
      catch (error) {
        if (error.status === 404) removed.add(id)
        else failures.push({ id, message: error.message })
      }
      if (generation !== actionGeneration) break
      deleteProgress.value++
      data.value = allRows.value.filter(event => !removed.has(event.id))
      if (selectedEvent.value && removed.has(selectedEvent.value.id)) selectedEvent.value = null
    }
    if (generation === actionGeneration) {
      checkedIds.value = new Set(failures.map(item => item.id))
      deleteMessage.value = `${removed.size}건을 삭제했습니다.`
      if (failures.length) deleteError.value = `${failures.length}건은 삭제하지 못했습니다. ${failures.slice(0, 3).map(item => `#${item.id}: ${item.message}`).join(' / ')}`
    }
  } finally { deleting.value = false }
}
watch(() => props.resource, () => { actionGeneration++; search.value = ''; checkedIds.value = new Set(); selectedCamera.value = null; selectedEvent.value = null; deleteError.value = ''; deleteMessage.value = '' })
onBeforeUnmount(() => { actionGeneration++ })
const sourceLabel = camera => camera.sourceType === 'live' ? '실시간 CCTV' : camera.sourceType === 'test' ? '테스트 CCTV' : '정보 없음'
const cameraHistory = ref([])
const cameraVideos = ref([])
const cameraMonitor = ref(null)
const cameraExtraLoading = ref(false)
const cameraExtraError = ref('')
const cameraHistoryLoaded = ref(false)
const cameraVideosLoaded = ref(false)
const lastDetected = event => event.endedAt ?? event.updatedAt ?? event.detectedAt
const latestCameraEvent = computed(() => [...cameraHistory.value].sort((a, b) =>
  Date.parse(lastDetected(b)) - Date.parse(lastDetected(a)))[0] ?? null)
const monitorLabel = computed(() => ({ running: '감시 중', starting: '시작 중', restarting: '재시작 중', waiting_for_ai: 'AI 연결 대기', waiting_for_cctv: 'CCTV 연결 대기', stopped: '감시 중지', failed: '감시 오류' })[cameraMonitor.value?.state] ?? '정보 없음')
watch(selectedCamera, async (camera, _previous, onCleanup) => {
  cameraHistory.value = []; cameraVideos.value = []; cameraMonitor.value = null; cameraExtraError.value = ''; cameraHistoryLoaded.value = false; cameraVideosLoaded.value = false
  if (!camera) { cameraExtraLoading.value = false; return }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  let cancelled = false
  onCleanup(() => { cancelled = true; controller.abort(); clearTimeout(timeout) })
  cameraExtraLoading.value = true
  const results = await Promise.allSettled([
    fetchEvents({ signal: controller.signal }), fetchVideos({ signal: controller.signal }),
    camera.sourceType === 'live' ? fetchLiveMonitorStatus({ signal: controller.signal }) : Promise.resolve(null),
  ])
  clearTimeout(timeout)
  if (cancelled || selectedCamera.value?.id !== camera.id) return
  if (results[0].status === 'fulfilled') { cameraHistory.value = results[0].value.filter(event => event.cameraId === camera.id); cameraHistoryLoaded.value = true }
  if (results[1].status === 'fulfilled') { cameraVideos.value = results[1].value.filter(video => video.camera_id === camera.id); cameraVideosLoaded.value = true }
  if (results[2].status === 'fulfilled') cameraMonitor.value = results[2].value?.cameras?.find(item => item.camera_id === camera.id) ?? null
  if (results.some(result => result.status === 'rejected')) cameraExtraError.value = '일부 추가 정보를 가져오지 못했습니다. 팝업을 다시 열어 확인해 주세요.'
  cameraExtraLoading.value = false
})
const eventDetailError = ref('')
const eventPosition = ref(0)
const eventPlaybackSequence = ref(0)
const eventRange = computed(() => errorRangeDisplay(selectedEvent.value?.estimatedLocation))
function seekEventCapture(seconds) { eventPosition.value = seconds; eventPlaybackSequence.value++ }
watch(() => selectedEvent.value?.id, (id, _previous, onCleanup) => {
  eventDetailError.value = ''; eventPosition.value = 0; eventPlaybackSequence.value++
  if (!id) return
  let cancelled = false, reading = false, controller
  async function refresh() {
    if (reading) return
    reading = true
    controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const event = await fetchEvent(id, { signal: controller.signal })
      if (!cancelled && selectedEvent.value?.id === id) { selectedEvent.value = { ...event, cameraName: selectedEvent.value.cameraName }; eventDetailError.value = '' }
    } catch (error) { if (!cancelled && selectedEvent.value?.id === id) eventDetailError.value = error.message }
    finally { clearTimeout(timeout); reading = false }
  }
  refresh()
  const timer = setInterval(() => { if (!document.hidden) refresh() }, 5000)
  onCleanup(() => { cancelled = true; clearInterval(timer); controller?.abort() })
})
</script>
<template>
  <div class="catalog-page">
    <header class="page-heading"><h1>{{ title }}</h1><button class="primary-button" :disabled="loading || deleting" @click="reload">새로고침</button></header>
    <p v-if="loading" role="status">목록을 불러오는 중입니다.</p>
    <div v-else-if="error" class="dashboard-panel" role="alert"><p>{{ error }}</p><button class="primary-button" @click="reload">다시 시도</button></div>
    <section v-else class="dashboard-panel">
      <label v-if="resource === 'cameras'" class="camera-search">카메라 검색<input v-model="search" type="search" placeholder="카메라 이름, 번호, 좌표, 유형 검색" /></label>
      <p>{{ resource === 'cameras' && search.trim() ? `검색 ${rows.length} / 전체 ${allRows.length}건` : `총 ${rows.length}건` }}</p>
      <div v-if="resource === 'events'" class="event-actions">
        <span>선택 {{ checkedIds.size }}건</span>
        <button type="button" class="delete-button" :disabled="deleting || checkedIds.size === 0" @click="removeCheckedEvents">{{ deleting ? `삭제 중 (${deleteProgress}/${deleteTotal})` : '선택 삭제' }}</button>
        <span class="interaction-hint">이벤트를 더블클릭하면 상세 정보를 볼 수 있습니다.</span>
      </div>
      <p v-if="deleteMessage" role="status">{{ deleteMessage }}</p>
      <p v-if="deleteError" role="alert" class="action-error">{{ deleteError }}</p>
      <p v-if="!rows.length" class="empty-message">{{ resource === 'cameras' && search.trim() ? '검색 결과가 없습니다.' : `등록된 ${resource === 'cameras' ? '카메라가' : '탐지 이벤트가'} 없습니다.` }}</p>
      <div v-else class="table-scroll">
        <table v-if="resource === 'cameras'"><caption class="sr-only">카메라 목록</caption><thead><tr><th>이름</th><th>위도</th><th>경도</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id" class="camera-row" tabindex="0" title="더블클릭하면 카메라 상세 정보를 봅니다" @dblclick="openCamera(row)" @keydown.enter="openCamera(row)"><td>{{ row.name }}</td><td>{{ row.latitude ?? '정보 없음' }}</td><td>{{ row.longitude ?? '정보 없음' }}</td></tr></tbody></table>
        <table v-else>
          <caption class="sr-only">체크박스로 삭제 대상을 선택하고 이벤트를 더블클릭하면 상세 정보를 확인합니다.</caption>
          <thead><tr><th><input type="checkbox" aria-label="이벤트 전체 선택" :checked="allChecked" :indeterminate="checkedIds.size > 0 && !allChecked" :disabled="deleting" @change="checkAll($event.target.checked)"></th><th>ID</th><th>탐지 시각</th><th>카메라</th><th>유형</th><th>상태</th></tr></thead>
          <tbody><tr v-for="row in rows" :key="row.id" class="event-row" :class="{ checked: checkedIds.has(row.id) }" tabindex="0" title="더블클릭하면 이벤트 상세 정보를 봅니다" @dblclick="openEvent(row)" @keydown.enter.self="openEvent(row)">
            <td @dblclick.stop><input type="checkbox" :aria-label="`이벤트 ${row.id} 선택`" :checked="checkedIds.has(row.id)" :disabled="deleting" @change="checkEvent(row.id, $event.target.checked)"></td>
            <td>{{ row.id }}</td><td>{{ formatDetectedAt(row.detectedAt) }}</td><td>{{ row.cameraName }}</td><td>{{ formatType(row.type) }}</td><td>{{ formatStatus(row.status) }}</td>
          </tr></tbody>
        </table>
      </div>
    </section>
    <RecordDialog :open="!!selectedCamera" title="카메라 상세 정보" @close="selectedCamera = null">
      <dl v-if="selectedCamera" class="record-fields">
        <dt>카메라 이름</dt><dd>{{ selectedCamera.name }}</dd>
        <dt>카메라 ID</dt><dd>{{ selectedCamera.id }}</dd>
        <dt>유형</dt><dd>{{ sourceLabel(selectedCamera) }}</dd>
        <dt>위도</dt><dd>{{ selectedCamera.latitude ?? '정보 없음' }}</dd>
        <dt>경도</dt><dd>{{ selectedCamera.longitude ?? '정보 없음' }}</dd>
        <dt>등록 시각</dt><dd>{{ selectedCamera.createdAt ? formatDetectedAt(selectedCamera.createdAt) : '정보 없음' }}</dd>
      </dl>
      <p v-if="cameraExtraLoading" role="status">탐지 현황을 불러오는 중입니다.</p>
      <p v-if="cameraExtraError" role="alert" class="action-error">{{ cameraExtraError }}</p>
      <dl v-if="selectedCamera && !cameraExtraLoading" class="record-fields">
        <template v-if="cameraHistoryLoaded"><dt>탐지 이력</dt><dd>{{ cameraHistory.length }}건 · 화재 {{ cameraHistory.filter(event => event.type === 'fire').length }}건 / 연기 {{ cameraHistory.filter(event => event.type === 'smoke').length }}건</dd>
        <dt>미확인 이벤트</dt><dd>{{ cameraHistory.filter(event => event.status === 'UNCONFIRMED').length }}건</dd>
        <dt>마지막 탐지</dt><dd>{{ latestCameraEvent ? formatDetectedAt(lastDetected(latestCameraEvent)) : '탐지 이력 없음' }}</dd></template>
        <template v-if="selectedCamera.sourceType === 'test' && cameraVideosLoaded"><dt>등록 영상</dt><dd>{{ cameraVideos.map(video => video.original_filename).join(', ') || '등록된 영상 없음' }}</dd></template>
        <template v-if="selectedCamera.sourceType === 'live'"><dt>AI 감시 상태</dt><dd>{{ monitorLabel }}</dd><dt>최근 프레임 수신</dt><dd>{{ cameraMonitor?.last_frame_at ? formatDetectedAt(cameraMonitor.last_frame_at) : '수신 정보 없음' }}</dd></template>
      </dl>
      <template #actions><RouterLink v-if="selectedCamera" :to="{ path: '/', query: { camera: selectedCamera.id } }">대시보드에서 보기</RouterLink></template>
    </RecordDialog>
    <RecordDialog :open="!!selectedEvent" title="탐지 이벤트 정보" :busy="deleting" @close="selectedEvent = null">
      <dl v-if="selectedEvent" class="record-fields">
        <dt>이벤트 ID</dt><dd>{{ selectedEvent.id }}</dd>
        <dt>최초 탐지</dt><dd>{{ formatDetectedAt(selectedEvent.detectedAt) }}</dd>
        <dt>마지막 탐지</dt><dd>{{ formatDetectedAt(lastDetected(selectedEvent)) }}</dd>
        <dt>CCTV</dt><dd>{{ selectedEvent.cameraName }}</dd>
        <dt>탐지 유형</dt><dd>{{ formatType(selectedEvent.type) }}</dd>
        <dt>상태</dt><dd>{{ formatStatus(selectedEvent.status) }}</dd>
        <dt>확인 시각</dt><dd>{{ selectedEvent.acknowledgedAt ? formatDetectedAt(selectedEvent.acknowledgedAt) : '미확인' }}</dd>
        <dt>추정 위치</dt><dd v-if="selectedEvent.estimatedLocation">위도 {{ selectedEvent.estimatedLocation.latitude }} · 경도 {{ selectedEvent.estimatedLocation.longitude }}</dd><dd v-else>위치 추정 정보 없음</dd>
        <template v-if="selectedEvent.estimatedLocation"><dt>위치 오차</dt><dd>{{ eventRange.label }}</dd></template>
      </dl>
      <p v-if="eventDetailError" role="alert" class="action-error">{{ eventDetailError }}</p>
      <template v-if="selectedEvent?.videoId">
        <h3>원본 영상</h3><RecordedVideo :video-id="selectedEvent.videoId" :position="eventPosition" :sequence="eventPlaybackSequence" />
      </template>
      <EventCaptures v-if="selectedEvent" :key="selectedEvent.id" :event-id="selectedEvent.id" :latest-capture="selectedEvent.latestCapture" @seek="seekEventCapture" />
      <template #actions><RouterLink v-if="selectedEvent" :to="`/events/${selectedEvent.id}`">상세 보기</RouterLink></template>
    </RecordDialog>
  </div>
</template>
<style scoped>
.camera-search { display: grid; gap: 8px; max-width: 440px; font-size: 13px; }.camera-search input { padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface-2); color: var(--text); }
.record-fields { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 14px; font-size: 13px; }.record-fields dt { color: var(--text-3); }.record-fields dd { margin: 0; overflow-wrap: anywhere; }.event-row { cursor: pointer; }.delete-button { padding: 8px 12px; border: 1px solid var(--fire); border-radius: 8px; background: var(--fire-soft); color: var(--fire); cursor: pointer; }
.event-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 16px 0; }.interaction-hint { color: var(--text-3); font-size: 12px; }.event-row.checked { background: var(--accent-soft); }.action-error { color: var(--fire); }input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }button:disabled { opacity: .5; cursor: default; }
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.8px; margin: 0; }
.table-scroll { overflow-x: auto; }table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; white-space: nowrap; }th { background: var(--surface-2); color: var(--text-3); font-weight: 600; font-size: 12px; letter-spacing: 0.3px; }th, td { padding: 14px; border-bottom: 1px solid var(--line); }td { color: var(--text); }tbody tr:hover { background: var(--surface-2); }.camera-row { cursor: pointer; user-select: none; }a { color: var(--accent); }.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
