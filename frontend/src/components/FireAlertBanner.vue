<script setup>
import { computed } from 'vue'
import { cameraName } from '../utils/cameraName'
import { formatDetectedAt } from '../utils/eventFormat'
const props = defineProps({ events: { type: Array, required: true }, cameras: { type: Array, default: () => [] } })
const emit = defineEmits(['open', 'dismiss', 'acknowledge'])
const latest = computed(() => props.events[0])
</script>
<template>
  <div v-if="latest" class="fire-alert" role="alert">
    <strong>화재 탐지</strong>
    <span>{{ cameraName(latest.cameraId, cameras) }} · {{ formatDetectedAt(latest.detectedAt) }}<template v-if="events.length > 1"> 외 {{ events.length - 1 }}건</template></span>
    <span class="fire-alert-actions">
      <button type="button" class="open" @click="emit('open', latest.id)">이벤트 보기</button>
      <button type="button" class="open" @click="emit('acknowledge', events.map(event => event.id))">확인 완료</button>
      <button type="button" @click="emit('dismiss')">닫기</button>
    </span>
  </div>
</template>
<style scoped>
.fire-alert { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 0 0 14px; padding: 12px 16px; border: 1px solid rgba(255, 106, 87, 0.45); border-radius: var(--radius-sm); background: var(--fire-soft); color: var(--text); font-size: 13px; box-shadow: 0 0 22px rgba(255, 106, 87, 0.2); }
strong { color: var(--fire); letter-spacing: -0.2px; }
.fire-alert-actions { margin-left: auto; display: flex; gap: 8px; }
button { padding: 6px 12px; border-radius: var(--radius-sm); border: 1px solid var(--line-strong); background: var(--surface-2); color: var(--text); font-size: 12px; }
button.open { background: var(--fire); border-color: var(--fire); color: #1a0703; font-weight: 700; }
</style>
