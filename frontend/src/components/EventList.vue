<script setup>
import { formatConfidence, formatDetectedAt, formatType } from '../utils/eventFormat'
defineProps({ events: { type: Array, default: () => [] }, selectedId: { type: [Number, String], default: null } })
const emit = defineEmits(['select'])
</script>

<template>
  <section class="dashboard-panel" aria-labelledby="events-title">
    <h2 id="events-title">탐지 이벤트</h2>
    <p v-if="events.length === 0" class="empty-message">탐지 이벤트가 없습니다.</p>
    <ul v-else class="event-list">
      <li v-for="event in events" :key="event.id">
        <button type="button" class="event-button" :class="{ selected: event.id === selectedId }"
          :aria-pressed="event.id === selectedId" @click="emit('select', event.id)">
          <strong>{{ event.cameraName }} · {{ formatType(event.type) }}</strong>
          <time :datetime="event.detectedAt">{{ formatDetectedAt(event.detectedAt) }} (KST)</time>
          <span>AI 신뢰도 {{ formatConfidence(event.confidence) }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.event-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.event-button { width: 100%; padding: 16px; border: 2px solid #e0e5eb; border-radius: 8px; background: white; text-align: left; cursor: pointer; display: grid; gap: 8px; }
.event-button.selected { border-color: #2563eb; background: #eff6ff; }
time, span { font-size: 13px; color: #475569; }
</style>
