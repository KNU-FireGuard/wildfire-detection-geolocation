<script setup>
import { computed } from 'vue'
import { formatConfidence, formatDetectedAt, formatType, formatStatus } from '../utils/eventFormat'
const props = defineProps({ events: { type: Array, default: () => [] }, cameras: { type: Array, default: () => [] }, selectedId: { type: [Number, String], default: null } })
const emit = defineEmits(['select'])
const sortedEvents = computed(() => [...props.events].sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt)))
function cameraName(cameraId) {
  return props.cameras.find(camera => camera.id === cameraId)?.name ?? (cameraId == null ? '카메라 정보 없음' : `카메라 ${cameraId}`)
}
</script>

<template>
  <section class="dashboard-panel" aria-labelledby="events-title">
    <div class="panel-heading"><h2 id="events-title">최근 탐지 이벤트</h2><RouterLink to="/events">전체 보기</RouterLink><span class="event-count">총 {{ events.length }}건</span></div>
    <p v-if="events.length === 0" class="empty-message">탐지 이벤트가 없습니다.</p>
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
            <td><span class="status-badge" :class="{ pending: event.status === 'UNCONFIRMED', confirmed: event.status === 'CONFIRMED' }">{{ formatStatus(event.status) }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.event-count { color: #8493a7; font-size: 12px; }
.table-scroll { overflow-x: auto; }
.event-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12px; white-space: nowrap; }
th { background: #f5f7fb; color: #627188; font-weight: 500; padding: 12px 10px; font-size: 11px; }
td { padding: 12px 10px; border-bottom: 1px solid #edf1f6; height: 53px; }
tbody tr { cursor: pointer; transition: background .15s; }
tbody tr:hover { background: #f7faff; }
tbody tr.selected { background: #eef5ff; box-shadow: inset 3px 0 #3c88df; }
.event-button { padding: 0; background: transparent; border: 0; color: #465871; text-align: left; font-size: 11px; }
.event-number { color: #8794a6; }.camera-cell { font-weight: 600; }.confidence-cell { font-variant-numeric: tabular-nums; }
.type-label { display: inline-flex; align-items: center; gap: 5px; color: #64748b; }.type-label i { width: 5px; height: 5px; border-radius: 50%; background: #94a3b8; }.type-label.fire i { background: #f66a59; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 600px) { th, td { padding: 10px 8px; } }
</style>
