<script setup>
import { defineAsyncComponent } from 'vue'

const LiveVideo = defineAsyncComponent(() => import('./LiveVideo.vue'))

defineProps({
  cameras: { type: Array, required: true },
  selectedId: { type: Number, default: null },
})
const emit = defineEmits(['select'])
</script>

<template>
  <section class="dashboard-panel live-wall" aria-label="실시간 CCTV 영상">
    <div class="wall-heading">
      <div><h2>실시간 CCTV</h2><p>영상은 관제 화면이 열려 있는 동안 계속 재생됩니다</p></div>
      <span>{{ cameras.length }}대 영상</span>
    </div>
    <div class="live-grid">
      <article
        v-for="camera in cameras" :key="camera.id"
        class="live-tile" :class="{ selected: camera.id === selectedId }"
        @click="emit('select', camera.id)"
      >
        <LiveVideo :url="camera.streamUrl" />
        <button
          type="button" class="tile-select"
          :aria-pressed="camera.id === selectedId"
          :aria-label="`${camera.name} 영상 ${camera.id === selectedId ? '선택됨' : '확대'}`"
          @click.stop="emit('select', camera.id)"
        >
          <strong>{{ camera.name }}</strong>
          <span>{{ camera.id === selectedId ? '선택됨' : '크게 보기' }}</span>
        </button>
      </article>
    </div>
  </section>
</template>

<style scoped>
.live-wall { grid-column: 1 / -1; min-width: 0; }
.wall-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.wall-heading h2 { margin: 0 0 4px; font-size: 17px; }
.wall-heading p, .wall-heading > span { margin: 0; color: #66768b; font-size: 12px; }
.live-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.live-tile { min-width: 0; overflow: hidden; border: 2px solid transparent; border-radius: 6px; background: #111; cursor: pointer; }
.live-tile.selected { grid-column: 1 / -1; order: -1; border-color: #337fc8; }
.live-tile :deep(video) { width: 100%; height: 160px; max-height: none; object-fit: contain; }
.live-tile.selected :deep(video) { height: min(52vw, 480px); }
.tile-select { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 11px; border: 0; background: #253444; color: #fff; text-align: left; cursor: pointer; }
.tile-select strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.tile-select span { flex-shrink: 0; color: #bcd3ea; font-size: 11px; }
.tile-select:focus-visible { outline: 3px solid #7fc4ff; outline-offset: -3px; }
@media (max-width: 800px) { .live-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .live-grid { grid-template-columns: minmax(0, 1fr); }.live-tile.selected :deep(video) { height: 240px; } }
</style>
