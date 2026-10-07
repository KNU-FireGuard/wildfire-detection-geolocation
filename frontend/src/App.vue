<script setup>
import { computed, ref } from 'vue'
import EventList from './components/EventList.vue'
import MonitoringMap from './components/MonitoringMap.vue'
import EventDetail from './components/EventDetail.vue'
import { events } from './mocks/events'

const selectedEventId = ref(events[0]?.id ?? null)
const selectedEvent = computed(() => events.find(event => event.id === selectedEventId.value) ?? null)
function selectEvent(id) {
  selectedEventId.value = id
}
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <h1>FireGuard AI</h1>
      <p>산불 감지 및 화재 위치 추정 모니터링 시스템</p>
    </header>
    <main class="app-main">
      <EventList :events="events" :selected-id="selectedEventId" @select="selectEvent" />
      <MonitoringMap :events="events" :selected-id="selectedEventId" @select="selectEvent" />
      <EventDetail :event="selectedEvent" />
    </main>
  </div>
</template>

<style scoped>
.app-container {
  max-width: 1440px;
  margin: 0 auto;
  padding: 32px 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.app-header {
  margin-bottom: 24px;
  border-bottom: 1px solid #e9ecef;
  padding-bottom: 16px;
}

.app-header h1 {
  margin: 0 0 8px 0;
  font-size: 28px;
  color: #1a1a1a;
}

.app-header p {
  margin: 0;
  color: #666;
  font-size: 15px;
}

.app-main { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(320px, 1.6fr) minmax(260px, 1fr); gap: 16px; align-items: start; }
.app-main > * { min-width: 0; }
@media (max-width: 1000px) { .app-main { grid-template-columns: 1fr; } }
</style>
