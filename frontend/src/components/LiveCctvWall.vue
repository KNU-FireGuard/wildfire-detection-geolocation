<script setup>
import { defineAsyncComponent } from 'vue'

const LiveVideo = defineAsyncComponent(() => import('./LiveVideo.vue'))

const props = defineProps({
  cameras: { type: Array, required: true },
  selectedId: { type: Number, default: null },
})
const emit = defineEmits(['select'])
// 선택된 타일을 다시 누르면 null로 선택 해제
function toggle(id) { emit('select', id === props.selectedId ? null : id) }
</script>

<template>
  <section class="dashboard-panel live-wall" aria-label="실시간 CCTV 영상">
    <div class="wall-heading">
      <div><h2>실시간 CCTV</h2><p>영상은 관제 화면이 열려 있는 동안 계속 재생됩니다</p></div>
      <span>{{ cameras.length }}대</span>
    </div>
    <div class="live-grid">
      <article
        v-for="camera in cameras" :key="camera.id"
        class="live-tile" :class="{ selected: camera.id === selectedId }"
        @click="toggle(camera.id)"
      >
        <LiveVideo v-if="camera.streamUrl" :url="camera.streamUrl" :camera-id="camera.id" />
        <div v-else class="tile-empty" role="status"><strong>영상 주소가 없습니다.</strong><span>CCTV 주소 갱신 후 다시 확인하세요.</span></div>
        <button
          type="button" class="tile-select"
          :aria-pressed="camera.id === selectedId"
          :aria-label="`${camera.name} 선택`"
          @click.stop="toggle(camera.id)"
        >
          <strong>{{ camera.name }}</strong>
        </button>
      </article>
    </div>
  </section>
</template>

<style scoped>
.live-wall { grid-column: 1 / -1; min-width: 0; }
.wall-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
.wall-heading h2 { margin: 0 0 4px; font-size: 15px; }
.wall-heading p, .wall-heading > span { margin: 0; color: var(--text-3); font-size: 12px; }
.live-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.live-tile { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: #05080c; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; }
.live-tile:hover { border-color: var(--line-strong); }
.live-tile.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 0 28px rgba(85, 169, 255, 0.28); }
.live-tile :deep(video) { width: 100%; height: 160px; max-height: none; object-fit: contain; }
.tile-empty { display: grid; align-content: center; justify-items: center; gap: 4px; height: 160px; color: var(--text-2); background: #05080c; font-size: 12px; text-align: center; }
.tile-select { display: flex; width: 100%; align-items: center; gap: 9px; padding: 10px 12px; border: 0; border-top: 1px solid var(--line); background: linear-gradient(180deg, #131c27, #0d141d); color: var(--text); text-align: left; transition: background 0.15s; }
.tile-select::before { content: ''; flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; background: var(--text-3); }
.live-tile.selected .tile-select::before { background: var(--accent); box-shadow: 0 0 9px var(--accent); }
.tile-select:hover { background: var(--surface-3); }
.tile-select strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 600; }
.tile-select:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
@media (max-width: 800px) { .live-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .live-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
