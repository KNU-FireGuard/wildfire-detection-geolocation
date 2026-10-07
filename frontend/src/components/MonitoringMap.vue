<script setup>
import { computed } from 'vue'
const props = defineProps({ events: { type: Array, default: () => [] }, selectedId: { type: [Number, String], default: null } })
const emit = defineEmits(['select'])
const selectedEvent = computed(() => props.events.find(event => event.id === props.selectedId) ?? null)
// 실제 지도 투영 대신 좌표 범위를 임시 영역의 20~80%에 배치합니다.
const markers = computed(() => {
  const located = props.events.filter(event => event.location != null)
  if (!located.length) return []
  const latitudes = located.map(event => event.location.latitude)
  const longitudes = located.map(event => event.location.longitude)
  const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes)
  const minLng = Math.min(...longitudes), maxLng = Math.max(...longitudes)
  return located.map(event => ({
    event,
    left: maxLng === minLng ? 50 : 20 + 60 * (event.location.longitude - minLng) / (maxLng - minLng),
    top: maxLat === minLat ? 50 : 80 - 60 * (event.location.latitude - minLat) / (maxLat - minLat),
  }))
})
</script>

<template>
  <section class="dashboard-panel" aria-labelledby="map-title">
    <h2 id="map-title">추정 위치</h2>
    <p class="map-caption">임시 지도 · 개발용 데이터</p>
    <div class="map-area" aria-label="산불 이벤트 임시 위치 지도">
      <button v-for="marker in markers" :key="marker.event.id" type="button" class="marker"
        :class="{ selected: marker.event.id === selectedId }"
        :style="{ left: `${marker.left}%`, top: `${marker.top}%` }"
        :aria-pressed="marker.event.id === selectedId"
        :aria-label="`${marker.event.cameraName} 이벤트 위치 선택`"
        @click="emit('select', marker.event.id)">{{ marker.event.cameraName }}</button>
    </div>
    <div class="map-selection" aria-live="polite">
      <p v-if="selectedEvent && !selectedEvent.location">위치 추정 정보가 없습니다.</p>
      <template v-else-if="selectedEvent">
        <strong>{{ selectedEvent.cameraName }} 선택됨</strong>
        <p>위도 {{ selectedEvent.location.latitude }} · 경도 {{ selectedEvent.location.longitude }}</p>
      </template>
      <p v-else>이벤트를 선택하면 추정 위치를 확인할 수 있습니다.</p>
    </div>
  </section>
</template>

<style scoped>
.map-caption { color: #64748b; font-size: 13px; }
.map-area { height: 360px; position: relative; border: 1px solid #cbd5e1; border-radius: 8px; background-color: #e8efe8; background-image: linear-gradient(#cbd5e166 1px, transparent 1px), linear-gradient(90deg, #cbd5e166 1px, transparent 1px); background-size: 36px 36px; }
.marker { position: absolute; transform: translate(-50%, -50%); padding: 10px; border: 2px solid #64748b; border-radius: 20px; background: white; color: #334155; cursor: pointer; white-space: nowrap; }
.marker.selected { background: #2563eb; border-color: #1d4ed8; color: white; box-shadow: 0 0 0 5px #2563eb33; z-index: 1; }
.map-selection { min-height: 72px; margin-top: 16px; overflow-wrap: anywhere; }
.map-selection p { font-size: 14px; color: #475569; }
</style>
