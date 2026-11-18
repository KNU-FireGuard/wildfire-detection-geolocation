<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchCameras, fetchEvents, fetchEvent, fetchVideos, fetchLiveMonitorStatus, deleteEvent } from '../api/catalog'
import RecordDialog from '../components/RecordDialog.vue'
import DashboardIcon from '../components/DashboardIcon.vue'
import EventCaptures from '../components/EventCaptures.vue'
import RecordedVideo from '../components/RecordedVideo.vue'
import { errorRangeDisplay } from '../maps/naverScene'
import { filterCameras } from '../utils/cameraSearch'
import { cameraName } from '../utils/cameraName'
import { formatDetectedAt, formatType, formatStatus } from '../utils/eventFormat'
import { useQuery } from '../composables/useQuery'
import { useAdminSession } from '../composables/useAdminSession'
import { defaultEventFilters, readEventCatalogQuery, writeEventCatalogQuery, eventDateRange, filterCatalogEvents, paginateCatalogEvents, kstToday } from '../utils/eventCatalog'
const { token, isLoggedIn, signOut } = useAdminSession()
const route = useRoute(), router = useRouter()
const props = defineProps({ resource: { type: String, required: true } })
const titles = { cameras: '카메라 목록', events: '탐지 이벤트' }
const descriptions = { cameras: '등록된 CCTV와 설치 정보를 확인합니다', events: '탐지 이력을 검색하고 확인 상태를 관리합니다' }
const eventCameras = ref([])
async function fetchEventsWithCameraNames({ signal }) {
  const [events, cameras] = await Promise.all([fetchEvents({ signal }), fetchCameras({ signal })])
  if (!signal?.aborted) eventCameras.value = cameras
  return events.map(event => ({ ...event, cameraName: cameraName(event.cameraId, cameras) }))
}
const loaders = { cameras: fetchCameras, events: fetchEventsWithCameraNames }
const title = computed(() => titles[props.resource])
const { data, loading, error, reload } = useQuery(() => props.resource, signal => loaders[props.resource]({ signal }))
const search = ref('')
const allRows = computed(() => data.value ?? [])
const eventState = computed(() => readEventCatalogQuery(route.query))
const eventDraft = reactive({ ...defaultEventFilters })
const filterError = ref('')
const calendarNow = ref(Date.now())
const calendarTimer = setInterval(() => { calendarNow.value = Date.now() }, 60000)
watch(eventState, state => Object.assign(eventDraft, state.filters), { immediate: true })
watch(eventDraft, () => { filterError.value = '' }, { flush: 'sync' })
const appliedRangeError = computed(() => eventDateRange(eventState.value.filters, calendarNow.value).error)
const filteredEvents = computed(() => props.resource === 'events' ? filterCatalogEvents(allRows.value, eventState.value.filters, calendarNow.value) : [])
const eventPage = computed(() => paginateCatalogEvents(filteredEvents.value, eventState.value.page, eventState.value.pageSize))
const rows = computed(() => props.resource === 'cameras' ? filterCameras(allRows.value, search.value) : eventPage.value.items)
const cameraOptions = computed(() => {
  const cameras = new Map(eventCameras.value.map(camera => [String(camera.id), camera.name]))
  for (const event of allRows.value) {
    if (event.cameraId != null && !cameras.has(String(event.cameraId))) cameras.set(String(event.cameraId), event.cameraName)
  }
  const selected = eventState.value.filters.cameraId
  if (selected !== 'all' && !cameras.has(selected)) cameras.set(selected, `CCTV #${selected} · 현재 이벤트 없음`)
  return [...cameras].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
})
const filterChips = computed(() => {
  const filters = eventState.value.filters
  const chips = []
  if (filters.search) chips.push({ key: 'search', label: `검색: ${filters.search}` })
  if (filters.type !== 'all') chips.push({ key: 'type', label: formatType(filters.type) })
  if (filters.status !== 'all') chips.push({ key: 'status', label: formatStatus(filters.status) })
  if (filters.cameraId !== 'all') chips.push({ key: 'cameraId', label: cameraOptions.value.find(camera => camera.id === filters.cameraId)?.name ?? `CCTV #${filters.cameraId}` })
  if (filters.period !== 'all') chips.push({ key: 'period', label: filters.period === 'custom' ? `${filters.from || '시작일 미입력'} ~ ${filters.to || '종료일 미입력'} (KST)` : filters.period === 'today' ? '오늘 (KST)' : '최근 7일 (KST)' })
  return chips
})
const resultCountLabel = computed(() => filterChips.value.length
  ? `검색 결과 ${filteredEvents.value.length}건 / 전체 ${allRows.value.length}건`
  : `전체 ${allRows.value.length}건`)
function setPeriod(period) {
  eventDraft.period = period
  if (period === 'custom') {
    if (!eventDraft.from) eventDraft.from = kstToday(calendarNow.value)
    if (!eventDraft.to) eventDraft.to = kstToday(calendarNow.value)
  }
}
function updateEventQuery(changes, replace = false) {
  return router[replace ? 'replace' : 'push']({ query: writeEventCatalogQuery({ ...eventState.value, ...changes }, route.query) })
}
function applyEventFilters() {
  if (deleting.value) return
  filterError.value = eventDateRange(eventDraft, calendarNow.value).error
  if (!filterError.value) return updateEventQuery({ filters: { ...eventDraft }, page: 1 })
}
function resetEventFilters() {
  if (!deleting.value) return updateEventQuery({ filters: { ...defaultEventFilters }, page: 1 })
}
function clearEventFilter(key) {
  if (deleting.value) return
  const filters = { ...eventState.value.filters, [key]: defaultEventFilters[key] }
  if (key === 'period') { filters.from = ''; filters.to = '' }
  return updateEventQuery({ filters, page: 1 })
}
function changePage(page) {
  if (!deleting.value) return updateEventQuery({ page })
}
function changePageSize(pageSize) {
  if (!deleting.value) return updateEventQuery({ page: 1, pageSize: Number(pageSize) })
}
watch([eventPage, loading], ([page, isLoading]) => {
  if (props.resource === 'events' && !isLoading && !error.value && data.value !== null && page.page !== eventState.value.page) {
    updateEventQuery({ page: page.page }, true)
  }
})
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
watch(() => route.query, () => {
  if (props.resource !== 'events') return
  actionGeneration++
  checkedIds.value = new Set()
  selectedEvent.value = null
  deleteError.value = ''; deleteMessage.value = ''; filterError.value = ''
}, { deep: true })
function openCamera(camera) { selectedCamera.value = camera }
function openEvent(event) { if (!deleting.value) selectedEvent.value = event }
async function removeCheckedEvents() {
  if (!isLoggedIn.value || !checkedIds.value.size || deleting.value) return
  const ids = [...checkedIds.value]
  if (!window.confirm(`선택한 이벤트 ${ids.length}건과 연결된 캡처를 삭제할까요? 문자 발송 이력은 보존됩니다.`)) return
  const generation = actionGeneration
  const sessionToken = token.value
  const isCurrentAction = () => generation === actionGeneration && token.value === sessionToken
  deleting.value = true
  deleteError.value = ''
  deleteMessage.value = ''
  deleteProgress.value = 0
  deleteTotal.value = ids.length
  const removed = new Set()
  const failures = []
  try {
    for (const id of ids) {
      if (!isCurrentAction()) break
      try { await deleteEvent(id, sessionToken); removed.add(id) }
      catch (error) {
        if (!isCurrentAction()) break
        if (error.status === 401) { signOut(); deleteError.value = '로그인이 만료되었습니다. 관리자 설정에서 다시 로그인해주세요.'; break }
        if (error.status === 404) removed.add(id)
        else failures.push({ id, message: error.message })
      }
      if (!isCurrentAction()) break
      deleteProgress.value++
      data.value = allRows.value.filter(event => !removed.has(event.id))
      if (selectedEvent.value && removed.has(selectedEvent.value.id)) selectedEvent.value = null
    }
    if (isCurrentAction()) {
      checkedIds.value = new Set(failures.map(item => item.id))
      deleteMessage.value = `${removed.size}건을 삭제했습니다.`
      if (failures.length) deleteError.value = `${failures.length}건은 삭제하지 못했습니다. ${failures.slice(0, 3).map(item => `#${item.id}: ${item.message}`).join(' / ')}`
    }
  } finally { deleting.value = false }
}
watch(() => props.resource, () => { actionGeneration++; search.value = ''; checkedIds.value = new Set(); selectedCamera.value = null; selectedEvent.value = null; deleteError.value = ''; deleteMessage.value = '' })
onBeforeUnmount(() => { actionGeneration++; clearInterval(calendarTimer) })
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
const monitorLabel = computed(() => ({
  running: '감시 중', starting: '시작 중', restarting: '재시작 중',
  waiting_for_ai: 'AI 연결 대기', waiting_for_cctv: 'CCTV 연결 대기',
  stopped: '감시 중지', failed: '감시 오류', connecting: '영상 연결 중',
  stream_error: '영상 수신 실패', analysis_delayed: '분석 지연',
})[cameraMonitor.value?.state] ?? '정보 없음')
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
    <header class="page-heading">
      <div class="page-title">
        <span class="page-title-icon" aria-hidden="true"><DashboardIcon :name="resource === 'cameras' ? 'camera' : 'bell'" :size="24" /></span>
        <div class="page-title-copy"><h1>{{ title }}</h1><p>{{ descriptions[resource] }}</p></div>
      </div>
      <button class="primary-button" :disabled="loading || deleting" @click="reload">새로고침</button>
    </header>
    <p v-if="loading" role="status">목록을 불러오는 중입니다.</p>
    <div v-else-if="error" class="dashboard-panel" role="alert"><p>{{ error }}</p><button class="primary-button" @click="reload">다시 시도</button></div>
    <section v-else class="dashboard-panel">
      <label v-if="resource === 'cameras'" class="camera-search">카메라 검색<input v-model="search" type="search" placeholder="카메라 이름, 번호, 좌표, 유형 검색" /></label>
      <form v-else class="event-search-form" aria-label="이벤트 검색 및 필터" novalidate @submit.prevent="applyEventFilters">
        <div class="filter-heading"><h2>이벤트 검색</h2><span id="event-period-help">최초 탐지 시각 · 한국표준시(KST) 기준</span></div>
        <fieldset class="event-filter-fields" :disabled="deleting">
          <legend class="sr-only">검색 조건</legend>
          <div class="event-filter-grid">
            <label class="event-search-input">카메라 이름 / 이벤트 번호<input v-model="eventDraft.search" type="search" maxlength="200" aria-label="카메라 이름 또는 이벤트 번호 검색" placeholder="예: 청성, #123" /></label>
            <label>유형<select v-model="eventDraft.type" aria-label="이벤트 유형 필터"><option value="all">전체 유형</option><option value="fire">화재</option><option value="smoke">연기</option></select></label>
            <label>확인 상태<select v-model="eventDraft.status" aria-label="이벤트 확인 상태 필터"><option value="all">전체 상태</option><option value="UNCONFIRMED">미확인</option><option value="CONFIRMED">확인 완료</option></select></label>
            <label>CCTV<select v-model="eventDraft.cameraId" aria-label="카메라 필터"><option value="all">전체 카메라</option><option v-for="camera in cameraOptions" :key="camera.id" :value="camera.id">{{ camera.name }}</option></select></label>
          </div>
          <div class="event-period-row">
            <span class="filter-label">기간</span>
            <div class="period-presets" role="group" aria-label="탐지 기간 선택">
              <button v-for="preset in [{ value: 'all', label: '전체 기간' }, { value: 'today', label: '오늘' }, { value: 'week', label: '최근 7일' }, { value: 'custom', label: '직접 기간' }]" :key="preset.value" type="button" :aria-pressed="eventDraft.period === preset.value" @click="setPeriod(preset.value)">{{ preset.label }}</button>
            </div>
            <div v-if="eventDraft.period === 'custom'" class="custom-period">
              <label>시작일<input v-model="eventDraft.from" type="date" aria-label="시작일" aria-describedby="event-period-help event-filter-error" :aria-invalid="!!(filterError || appliedRangeError)" /></label>
              <span aria-hidden="true">~</span>
              <label>종료일<input v-model="eventDraft.to" type="date" aria-label="종료일" aria-describedby="event-period-help event-filter-error" :aria-invalid="!!(filterError || appliedRangeError)" /></label>
            </div>
            <button type="submit" class="apply-filters">필터 적용</button>
          </div>
        </fieldset>
        <p v-if="filterError || appliedRangeError" id="event-filter-error" class="action-error" role="alert">{{ filterError || appliedRangeError }}</p>
      </form>
      <div v-if="resource === 'events'" class="filter-summary" role="group" aria-label="이벤트 검색 결과">
        <p class="result-count" role="status">{{ resultCountLabel }}</p>
        <button type="button" class="reset-event-filters" aria-label="모든 필터 초기화" :disabled="deleting" @click="resetEventFilters">필터 초기화</button>
        <div v-if="filterChips.length" class="filter-chips" aria-label="적용 중인 필터"><button v-for="chip in filterChips" :key="chip.key" type="button" class="filter-chip" :aria-label="`${chip.label} 필터 해제`" :disabled="deleting" @click="clearEventFilter(chip.key)">{{ chip.label }} <span aria-hidden="true">×</span></button></div>
      </div>
      <p v-else>{{ search.trim() ? `검색 ${rows.length} / 전체 ${allRows.length}건` : `총 ${rows.length}건` }}</p>
      <div v-if="resource === 'events' && isLoggedIn" class="event-actions">
        <span>현재 페이지 선택 {{ checkedIds.size }}건</span>
        <button type="button" class="delete-button" :disabled="deleting || checkedIds.size === 0" @click="removeCheckedEvents">{{ deleting ? `삭제 중 (${deleteProgress}/${deleteTotal})` : '선택 삭제' }}</button>
        <span class="interaction-hint">이벤트를 더블클릭하면 상세 정보를 볼 수 있습니다.</span>
      </div>
      <p v-if="deleteMessage" role="status">{{ deleteMessage }}</p>
      <p v-if="deleteError" role="alert" class="action-error">{{ deleteError }}</p>
      <p v-if="!rows.length" class="empty-message">{{ resource === 'events' && allRows.length ? '선택한 조건에 맞는 이벤트가 없습니다. 필터를 변경하거나 초기화해주세요.' : resource === 'cameras' && search.trim() ? '검색 결과가 없습니다.' : `등록된 ${resource === 'cameras' ? '카메라가' : '탐지 이벤트가'} 없습니다.` }}</p>
      <div v-else class="table-scroll">
        <table v-if="resource === 'cameras'"><caption class="sr-only">카메라 목록</caption><thead><tr><th>이름</th><th>위도</th><th>경도</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id" class="camera-row" tabindex="0" title="더블클릭하면 카메라 상세 정보를 봅니다" @dblclick="openCamera(row)" @keydown.enter="openCamera(row)"><td>{{ row.name }}</td><td>{{ row.latitude ?? '정보 없음' }}</td><td>{{ row.longitude ?? '정보 없음' }}</td></tr></tbody></table>
        <table v-else>
          <caption class="sr-only">현재 페이지의 이벤트만 선택할 수 있습니다. 이벤트를 더블클릭하거나 Enter를 누르면 상세 정보를 확인합니다.</caption>
          <thead><tr><th v-if="isLoggedIn"><input type="checkbox" aria-label="현재 페이지 이벤트 전체 선택" :checked="allChecked" :indeterminate="checkedIds.size > 0 && !allChecked" :disabled="deleting" @change="checkAll($event.target.checked)"></th><th scope="col">ID</th><th scope="col">탐지 시각 (KST)</th><th scope="col">카메라</th><th scope="col">유형</th><th scope="col">상태</th></tr></thead>
          <tbody><tr v-for="row in rows" :key="row.id" class="event-row" :class="{ checked: checkedIds.has(row.id) }" tabindex="0" title="더블클릭하면 이벤트 상세 정보를 봅니다" @dblclick="openEvent(row)" @keydown.enter.self="openEvent(row)">
            <td v-if="isLoggedIn" @dblclick.stop><input type="checkbox" :aria-label="`이벤트 ${row.id} 선택`" :checked="checkedIds.has(row.id)" :disabled="deleting" @change="checkEvent(row.id, $event.target.checked)"></td>
            <td>{{ row.id }}</td><td>{{ formatDetectedAt(row.detectedAt) }}</td><td>{{ row.cameraName }}</td>
            <td><span class="event-type-label" :class="row.type"><DashboardIcon v-if="row.type === 'fire' || row.type === 'smoke'" :name="row.type" :size="15" />{{ formatType(row.type) }}</span></td>
            <td><span class="status-badge" :class="{ pending: row.status === 'UNCONFIRMED', confirmed: row.status === 'CONFIRMED' }">{{ formatStatus(row.status) }}</span></td>
          </tr></tbody>
        </table>
      </div>
      <nav v-if="resource === 'events' && eventPage.total" class="event-pagination" aria-label="이벤트 페이지 이동">
        <span class="page-range" role="status">{{ eventPage.start }}–{{ eventPage.end }} / {{ eventPage.total }}건</span>
        <label>페이지당<select :value="eventState.pageSize" aria-label="페이지당 이벤트 수" :disabled="deleting" @change="changePageSize($event.target.value)"><option :value="20">20건</option><option :value="50">50건</option><option :value="100">100건</option></select></label>
        <div class="page-buttons">
          <button type="button" aria-label="첫 페이지" :disabled="deleting || eventPage.page === 1" @click="changePage(1)">«</button>
          <button type="button" aria-label="이전 페이지" :disabled="deleting || eventPage.page === 1" @click="changePage(eventPage.page - 1)">‹</button>
          <span aria-live="polite">{{ eventPage.page }} / {{ eventPage.pageCount }} 페이지</span>
          <button type="button" aria-label="다음 페이지" :disabled="deleting || eventPage.page === eventPage.pageCount" @click="changePage(eventPage.page + 1)">›</button>
          <button type="button" aria-label="마지막 페이지" :disabled="deleting || eventPage.page === eventPage.pageCount" @click="changePage(eventPage.pageCount)">»</button>
        </div>
      </nav>
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
      <template #actions><RouterLink v-if="selectedEvent" :to="{ path: `/events/${selectedEvent.id}`, query: route.query }">상세 보기</RouterLink></template>
    </RecordDialog>
  </div>
</template>
<style scoped>
.event-search-form { margin-bottom: 22px; padding: 20px; border: 1px solid var(--line-strong); border-radius: 12px; background: var(--surface-2); }
.filter-heading { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }.filter-heading span { color: var(--text-3); font-size: 12px; }
.event-filter-fields { min-width: 0; margin: 0; padding: 0; border: 0; }.event-filter-fields:disabled { opacity: .65; }
.event-filter-grid { display: grid; grid-template-columns: minmax(210px, 2fr) repeat(3, minmax(130px, 1fr)); gap: 12px; }
.event-filter-grid label, .custom-period label { display: grid; gap: 7px; min-width: 0; color: var(--text-2); font-size: 12px; }.event-filter-grid input, .event-filter-grid select { width: 100%; min-width: 0; min-height: 40px; background: var(--surface); }
.event-period-row { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin-top: 16px; }.filter-label { padding-bottom: 12px; color: var(--text-2); font-size: 12px; }.period-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.period-presets button, .page-buttons button { min-height: 36px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface-2); color: var(--text-2); padding: 7px 12px; font-size: 12px; }.period-presets button[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.period-presets button { min-height: 40px; }
.custom-period { display: flex; align-items: end; flex-wrap: wrap; gap: 8px; }.custom-period > span { padding-bottom: 12px; color: var(--text-3); }.custom-period input { min-width: 0; max-width: 100%; min-height: 40px; background: var(--surface); }.custom-period input[aria-invalid="true"] { border-color: var(--fire); }
.apply-filters { min-height: 40px; margin-left: auto; padding: 9px 20px; border: 1px solid var(--accent); border-radius: 8px; background: var(--accent-soft); color: var(--text); font-size: 13px; font-weight: 650; }
.filter-summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; margin: 0 0 16px; padding-bottom: 16px; border-bottom: 1px solid var(--line); }.result-count { margin: 0; font-size: 14px; font-weight: 650; color: var(--text); }.filter-chips { display: flex; flex-wrap: wrap; gap: 6px; grid-column: 1 / -1; }
.filter-chip { max-width: 100%; padding: 6px 10px; border: 1px solid var(--line-strong); border-radius: 999px; background: var(--surface-2); color: var(--text); font-size: 12px; overflow-wrap: anywhere; }.filter-chip span { margin-left: 6px; color: var(--text-3); }.reset-event-filters { min-height: 36px; padding: 6px 8px; border: 0; background: transparent; color: var(--accent); font-size: 12px; }
.event-pagination { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin-top: 18px; color: var(--text-2); font-size: 12px; }.page-range { margin-right: auto; }.event-pagination label { display: flex; align-items: center; gap: 8px; }.event-pagination select { padding: 7px 9px; }.page-buttons { display: flex; align-items: center; gap: 6px; }.page-buttons button { min-width: 36px; font-size: 17px; }.page-buttons > span { padding: 0 6px; font-variant-numeric: tabular-nums; }
@media (max-width: 1100px) { .event-filter-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .event-filter-grid { grid-template-columns: minmax(0, 1fr); }.filter-heading { align-items: flex-start; flex-direction: column; }.apply-filters { width: 100%; margin-left: 0; }.event-pagination { gap: 12px; }.page-buttons { width: 100%; justify-content: center; }.custom-period { width: 100%; }.custom-period label { flex: 1; min-width: 125px; } }
@media (max-width: 600px) { .event-search-form { padding: 16px; }.custom-period { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }.custom-period > span { display: none; }.custom-period label { min-width: 0; }.custom-period input { width: 100%; } }
.camera-search { display: grid; gap: 8px; max-width: 440px; font-size: 13px; }.camera-search input { padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface-2); color: var(--text); }
.record-fields { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 14px; font-size: 13px; }.record-fields dt { color: var(--text-3); }.record-fields dd { margin: 0; overflow-wrap: anywhere; }.event-row { cursor: pointer; }.delete-button { padding: 8px 12px; border: 1px solid var(--fire); border-radius: 8px; background: var(--fire-soft); color: var(--fire); cursor: pointer; }
.event-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 16px 0; }.interaction-hint { color: var(--text-3); font-size: 12px; }.event-row.checked { background: var(--accent-soft); }.action-error { color: var(--fire); }input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }button:disabled { opacity: .5; cursor: default; }
.page-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin-bottom: 20px; }
.table-scroll { overflow-x: auto; }table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; white-space: nowrap; }th { background: var(--surface-2); color: var(--text-3); font-weight: 600; font-size: 12px; letter-spacing: 0.3px; }th, td { padding: 14px; border-bottom: 1px solid var(--line); }td { color: var(--text); }tbody tr:hover { background: var(--surface-2); }.camera-row { cursor: pointer; user-select: none; }a { color: var(--accent); }.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
