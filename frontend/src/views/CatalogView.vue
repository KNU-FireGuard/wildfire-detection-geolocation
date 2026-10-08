<script setup>
import { computed, ref, watch } from 'vue'
import { fetchCameras, fetchEvents, fetchVideos } from '../api/catalog'
import { formatConfidence, formatDetectedAt, formatType } from '../utils/eventFormat'
import { useQuery } from '../composables/useQuery'
const props = defineProps({ resource: { type: String, required: true } })
const titles = { cameras: '카메라 목록', videos: '영상 목록', events: '탐지 이벤트' }
const loaders = { cameras: fetchCameras, videos: fetchVideos, events: fetchEvents }
const title = computed(() => titles[props.resource])
const { data, loading, error, reload } = useQuery(() => props.resource, signal => loaders[props.resource]({ signal }))
const rows = computed(() => data.value ?? [])
const selectedVideoId = ref(null)
const selectedVideo = computed(() => rows.value.find(row => row.id === selectedVideoId.value) ?? null)
watch(() => props.resource, () => { selectedVideoId.value = null })
</script>
<template>
  <div class="catalog-page">
    <header class="page-heading"><h1>{{ title }}</h1><button class="primary-button" :disabled="loading" @click="reload">새로고침</button></header>
    <p v-if="loading" role="status">목록을 불러오는 중입니다.</p>
    <div v-else-if="error" class="dashboard-panel" role="alert"><p>{{ error }}</p><button class="primary-button" @click="reload">다시 시도</button></div>
    <section v-else class="dashboard-panel">
      <p>총 {{ rows.length }}건</p>
      <p v-if="!rows.length" class="empty-message">등록된 {{ resource === 'cameras' ? '카메라가' : resource === 'videos' ? '영상이' : '탐지 이벤트가' }} 없습니다.</p>
      <div v-else class="table-scroll">
        <table v-if="resource === 'cameras'"><caption class="sr-only">카메라 목록</caption><thead><tr><th>ID</th><th>이름</th><th>위도</th><th>경도</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.id }}</td><td>{{ row.name }}</td><td>{{ row.latitude ?? '정보 없음' }}</td><td>{{ row.longitude ?? '정보 없음' }}</td></tr></tbody></table>
        <table v-else-if="resource === 'videos'"><caption class="sr-only">영상 목록</caption><thead><tr><th>ID</th><th>카메라 ID</th><th>파일 이름</th><th>등록 시각</th><th>재생</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.id }}</td><td>{{ row.camera_id ?? '정보 없음' }}</td><td>{{ row.original_filename }}</td><td>{{ formatDetectedAt(row.created_at) }}</td><td><button type="button" class="play-button" @click="selectedVideoId = row.id">재생</button></td></tr></tbody></table>
        <table v-else><caption class="sr-only">탐지 이벤트 목록</caption><thead><tr><th>ID</th><th>탐지 시각</th><th>카메라 ID</th><th>유형</th><th>신뢰도</th><th>상세</th></tr></thead><tbody><tr v-for="row in rows" :key="row.id"><td>{{ row.id }}</td><td>{{ formatDetectedAt(row.detectedAt) }}</td><td>{{ row.cameraId ?? '정보 없음' }}</td><td>{{ formatType(row.type) }}</td><td>{{ formatConfidence(row.confidence) }}</td><td><RouterLink :to="`/events/${row.id}`">상세 보기</RouterLink></td></tr></tbody></table>
      </div>
      <section v-if="resource === 'videos' && selectedVideo" class="video-player" aria-label="영상 재생">
        <h2>{{ selectedVideo.original_filename }}</h2>
        <video :key="selectedVideo.id" controls preload="metadata" :src="`/api/videos/${selectedVideo.id}/stream`">
          이 브라우저는 영상 재생을 지원하지 않습니다.
        </video>
      </section>
      <p v-else-if="resource === 'videos'" class="empty-message">재생할 영상을 목록에서 선택하세요.</p>
    </section>
  </div>
</template>
<style scoped>
.page-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }h1 { font-size: 26px; margin: 0; }
.table-scroll { overflow-x: auto; }table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; white-space: nowrap; }th { background: #f5f7fb; }th, td { padding: 14px; border-bottom: 1px solid #edf1f6; }a { color: #337fd4; }.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.play-button { border: 0; border-radius: 6px; padding: 7px 12px; color: white; background: #337fd4; cursor: pointer; }.video-player { margin-top: 24px; }.video-player h2 { overflow-wrap: anywhere; font-size: 18px; }.video-player video { display: block; width: 100%; max-height: 70vh; background: #111; }
</style>
