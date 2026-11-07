<script setup>
import { computed, ref, watch } from 'vue'
import { fetchCameras, fetchEvents, deleteEvent } from '../api/catalog'
import RecordDialog from '../components/RecordDialog.vue'
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
function openCamera(camera) { selectedCamera.value = camera }
function openEvent(event) { if (!deleting.value) { selectedEvent.value = event; deleteError.value = '' } }
async function removeSelectedEvent() {
  if (!selectedEvent.value || deleting.value) return
  const id = selectedEvent.value.id
  if (!window.confirm(`이벤트 #${id}와 연결된 캡처를 삭제할까요? 문자 발송 이력은 보존됩니다.`)) return
  deleting.value = true
  deleteError.value = ''
  try {
    await deleteEvent(id)
    data.value = allRows.value.filter(event => event.id !== id)
    selectedEvent.value = null
  } catch (error) { deleteError.value = error.message }
  finally { deleting.value = false }
}
watch(() => props.resource, () => { search.value = ''; selectedCamera.value = null; selectedEvent.value = null; deleteError.value = '' })
const sourceLabel = camera => camera.sourceType === 'live' ? '실시간 CCTV' : camera.sourceType === 'test' ? '테스트 CCTV' : '정보 없음'
</script>
<template>
  <div class="catalog-page">
    <header class="page-heading"><h1>{{ title }}</h1><button class="primary-button" :disabled="loading" @click="reload">새로고침</button></header>
    <p v-if="loading" role="status">목록을 불러오는 중입니다.</p>
    <div v-else-if="error" class="dashboard-panel" role="alert"><p>{{ error }}</p><button class="primary-button" @click="reload">다시 시도</button></div>
    <section v-else class="dashboard-panel">
      <label v-if="resource === 'cameras'" class="camera-search">카메라 검색<input v-model="search" type="search" placeholder="카메라 이름, 번호, 좌표, 유형 검색" /></label>
      <p>{{ resource === 'cameras' && search.trim() ? `검색 ${rows.length} / 전체 ${allRows.length}건` : `총 ${rows.length}건` }}</p>
      <p v-if="!rows.length" class="empty-message">{{ resource === 'cameras' && search.trim() ? '검색 결과가 없습니다.' : `등록된 ${resource === 'cameras' ? '카메라가' : '탐지 이벤트가'} 없습니다.` }}</p>
      <div v-else class="table-scroll">
        <table v-if="resource === 'cameras'"><caption class="sr-only">카메라 목록</caption><thead><tr><th>이름</th><th>위도</th><th>경도</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id" class="camera-row" tabindex="0" title="더블클릭하면 카메라 상세 정보를 봅니다" @dblclick="openCamera(row)" @keydown.enter="openCamera(row)"><td>{{ row.name }}</td><td>{{ row.latitude ?? '정보 없음' }}</td><td>{{ row.longitude ?? '정보 없음' }}</td></tr></tbody></table>
        <table v-else><caption class="sr-only">탐지 이벤트 목록</caption><thead><tr><th>ID</th><th>탐지 시각</th><th>카메라</th><th>유형</th><th>상세</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id" class="event-row" tabindex="0" title="클릭하면 이벤트 정보와 삭제 기능을 봅니다" @click="openEvent(row)" @keydown.enter.self="openEvent(row)"><td>{{ row.id }}</td><td>{{ formatDetectedAt(row.detectedAt) }}</td><td>{{ row.cameraName }}</td><td>{{ formatType(row.type) }}</td><td><RouterLink :to="`/events/${row.id}`" @click.stop>상세 보기</RouterLink></td></tr></tbody></table>
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
        <dt>제공자 식별 키</dt><dd>{{ selectedCamera.providerKey ?? '정보 없음' }}</dd>
      </dl>
      <template #actions><RouterLink v-if="selectedCamera" :to="{ path: '/', query: { camera: selectedCamera.id } }">대시보드에서 보기</RouterLink></template>
    </RecordDialog>
    <RecordDialog :open="!!selectedEvent" title="탐지 이벤트 정보" :busy="deleting" @close="selectedEvent = null">
      <dl v-if="selectedEvent" class="record-fields">
        <dt>이벤트 ID</dt><dd>{{ selectedEvent.id }}</dd>
        <dt>탐지 시각</dt><dd>{{ formatDetectedAt(selectedEvent.detectedAt) }}</dd>
        <dt>CCTV</dt><dd>{{ selectedEvent.cameraName }}</dd>
        <dt>탐지 유형</dt><dd>{{ formatType(selectedEvent.type) }}</dd>
        <dt>상태</dt><dd>{{ formatStatus(selectedEvent.status) }}</dd>
      </dl>
      <p v-if="deleteError" role="alert">{{ deleteError }}</p>
      <template #actions><button type="button" class="delete-button" :disabled="deleting" @click="removeSelectedEvent">{{ deleting ? '삭제 중…' : '이벤트 삭제' }}</button></template>
    </RecordDialog>
  </div>
</template>
<style scoped>
.camera-search { display: grid; gap: 8px; max-width: 440px; font-size: 13px; }.camera-search input { padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface-2); color: var(--text); }
.record-fields { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 14px; font-size: 13px; }.record-fields dt { color: var(--text-3); }.record-fields dd { margin: 0; overflow-wrap: anywhere; }.event-row { cursor: pointer; }.delete-button { padding: 8px 12px; border: 1px solid var(--fire); border-radius: 8px; background: var(--fire-soft); color: var(--fire); cursor: pointer; }
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.8px; margin: 0; }
.table-scroll { overflow-x: auto; }table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; white-space: nowrap; }th { background: var(--surface-2); color: var(--text-3); font-weight: 600; font-size: 12px; letter-spacing: 0.3px; }th, td { padding: 14px; border-bottom: 1px solid var(--line); }td { color: var(--text); }tbody tr:hover { background: var(--surface-2); }.camera-row { cursor: pointer; user-select: none; }a { color: var(--accent); }.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
