<script setup>
import { computed, ref } from 'vue'
import { cameraName as nameOf } from '../utils/cameraName'
import { formatConfidence, formatDetectedAt, formatType, formatStatus } from '../utils/eventFormat'
import { filterEvents } from '../utils/eventFilters'
const props = defineProps({ events: { type: Array, default: () => [] }, cameras: { type: Array, default: () => [] }, selectedId: { type: [Number, String], default: null } })
const emit = defineEmits(['select', 'acknowledge'])
const cameraName = cameraId => nameOf(cameraId, props.cameras)
const typeFilter = ref('all')
const statusFilter = ref('all')
const cameraFilter = ref('all')
const hasFilters = computed(() => typeFilter.value !== 'all' || statusFilter.value !== 'all' || cameraFilter.value !== 'all')
const filteredEvents = computed(() => filterEvents(props.events, {
  type: typeFilter.value,
  status: statusFilter.value,
  cameraId: cameraFilter.value,
}))
const sortedEvents = computed(() => [...filteredEvents.value].sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt)))
const cameraOptions = computed(() => [...props.cameras].sort((a, b) => a.name.localeCompare(b.name, 'ko')))
function resetFilters() {
  typeFilter.value = 'all'
  statusFilter.value = 'all'
  cameraFilter.value = 'all'
}
</script>

<template>
  <section class="dashboard-panel" aria-labelledby="events-title">
    <div class="panel-heading"><h2 id="events-title">최근 탐지 이벤트</h2><RouterLink to="/events">전체 보기</RouterLink><span class="event-count">표시 {{ filteredEvents.length }} / {{ events.length }}건</span></div>
    <form class="event-filters" aria-label="탐지 이벤트 필터" @submit.prevent>
      <label>유형
        <select v-model="typeFilter" aria-label="이벤트 유형 필터">
          <option value="all">전체 유형</option>
          <option value="fire">화재</option>
          <option value="smoke">연기</option>
        </select>
      </label>
      <label>확인 상태
        <select v-model="statusFilter" aria-label="이벤트 확인 상태 필터">
          <option value="all">전체 상태</option>
          <option value="UNCONFIRMED">미확인</option>
          <option value="CONFIRMED">확인 완료</option>
        </select>
      </label>
      <label>CCTV
        <select v-model="cameraFilter" aria-label="카메라 필터">
          <option value="all">전체 카메라</option>
          <option v-for="camera in cameraOptions" :key="camera.id" :value="String(camera.id)">{{ camera.name }}</option>
        </select>
      </label>
      <button v-if="hasFilters" type="button" class="reset-filters" @click="resetFilters">필터 초기화</button>
    </form>
    <p v-if="events.length === 0" class="empty-message">탐지 이벤트가 없습니다.</p>
    <p v-else-if="filteredEvents.length === 0" class="empty-message" role="status">선택한 조건에 맞는 이벤트가 없습니다.</p>
    <div v-else class="table-scroll">
      <table class="event-table">
        <caption class="sr-only">이벤트를 선택하면 지도와 상세 정보가 함께 변경됩니다.</caption>
        <thead><tr><th scope="col">번호</th><th scope="col">탐지 시각 (KST)</th><th scope="col">CCTV</th><th scope="col">유형</th><th scope="col">신뢰도</th><th scope="col">상태</th></tr></thead>
        <tbody>
          <tr v-for="event in sortedEvents" :key="event.id" :class="{ selected: event.id === selectedId }" @click="emit('select', event.id)">
            <td><span class="event-number">{{ event.id }}</span></td>
            <td><button type="button" class="event-button" :aria-pressed="event.id === selectedId" :aria-label="`${cameraName(event.cameraId)} ${formatType(event.type)} 이벤트 ${event.id} 선택`" @click.stop="emit('select', event.id)"><time :datetime="event.detectedAt">{{ formatDetectedAt(event.detectedAt) }}</time></button></td>
            <td class="camera-cell">{{ cameraName(event.cameraId) }}</td>
            <td><span class="type-label" :class="event.type"><i />{{ formatType(event.type) }}</span></td>
            <td class="confidence-cell">{{ formatConfidence(event.confidence) }}</td>
            <td><span class="status-badge" :class="{ pending: event.status === 'UNCONFIRMED', confirmed: event.status === 'CONFIRMED' }">{{ formatStatus(event.status) }}</span><button v-if="event.status === 'UNCONFIRMED'" type="button" class="ack-button" :aria-label="`이벤트 ${event.id} 확인`" @click.stop="emit('acknowledge', event.id)">확인</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.event-filters { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; margin: 4px 0 14px; }
.event-filters label { display: grid; gap: 5px; color: var(--text-3); font-size: 11px; }
.event-filters select { min-width: 118px; border: 1px solid var(--line-strong); border-radius: 8px; padding: 7px 10px; background: var(--surface-2); color: var(--text); font: inherit; }
.reset-filters { border: 0; padding: 7px 4px; background: transparent; color: var(--accent); font-size: 11px; cursor: pointer; }
.reset-filters:hover { text-decoration: underline; }
.ack-button { margin-left: 8px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--surface-3); color: var(--text); font-size: 11px; }
.ack-button:hover { border-color: var(--accent); color: var(--accent); }
.event-count { color: var(--text-3); font-size: 12px; }
.table-scroll { overflow-x: auto; }
.event-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; white-space: nowrap; }
th { background: var(--surface-2); color: var(--text-3); font-weight: 600; padding: 12px 12px; font-size: 11px; letter-spacing: 0.3px; }
th:first-child { border-radius: 8px 0 0 8px; }th:last-child { border-radius: 0 8px 8px 0; }
td { padding: 12px 12px; border-bottom: 1px solid var(--line); height: 53px; color: var(--text); }
tbody tr { cursor: pointer; transition: background 0.15s; }
tbody tr:hover { background: var(--surface-2); }
tbody tr.selected { background: var(--accent-soft); box-shadow: inset 3px 0 var(--accent); }
.event-button { padding: 0; background: transparent; border: 0; color: var(--text); text-align: left; font-size: 11px; }
.event-number { color: var(--text-3); }.camera-cell { font-weight: 650; }.confidence-cell { font-variant-numeric: tabular-nums; }
.type-label { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); }.type-label i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); }.type-label.fire { color: var(--text); }.type-label.fire i { background: var(--fire); box-shadow: 0 0 8px var(--fire); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 600px) { th, td { padding: 10px 8px; } }
</style>
