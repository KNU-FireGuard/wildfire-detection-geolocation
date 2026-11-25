<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { fetchEventCaptures } from '../api/catalog'

const props = defineProps({ eventId: { type: Number, required: true }, latestCapture: { type: Object, default: null }, previewLimit: { type: Number, default: 0 } })
const captures = ref([])
const error = ref('')
const more = ref(false)
const busy = ref(false)
const expanded = ref(false)
const previewDialog = ref(null)
const selectedCapture = ref(null)
async function openPreview(capture) {
  selectedCapture.value = capture
  await nextTick()
  if (selectedCapture.value && previewDialog.value && !previewDialog.value.open) previewDialog.value.showModal()
}
function closePreview() {
  previewDialog.value?.close()
  selectedCapture.value = null
}
let generation = 0
let timer
let controller
const ordered = computed(() => [...captures.value].sort((a, b) => a.video_time_ms - b.video_time_ms))
const displayed = computed(() => props.previewLimit > 0 ? ordered.value.slice(-props.previewLimit) : ordered.value)
const timestamp = milliseconds => `${(milliseconds / 1000).toFixed(1)}초`
async function load(older = false) {
  if (busy.value) return
  busy.value = true
  const current = generation
  const request = new AbortController()
  controller = request
  const timeout = setTimeout(() => request.abort(), 15000)
  try {
    const before = older ? ordered.value[0]?.video_time_ms : undefined
    const result = await fetchEventCaptures(props.eventId, { before, signal: request.signal })
    if (current !== generation) return
    const merged = new Map((older ? captures.value : []).map(item => [item.id, item]))
    result.items.forEach(item => merged.set(item.id, item))
    captures.value = [...merged.values()]
    more.value = result.items.length === 20
    expanded.value = older
    error.value = ''
  } catch (cause) {
    if (current === generation) error.value = cause.message
  } finally {
    clearTimeout(timeout)
    if (current === generation) busy.value = false
  }
}
watch(() => props.eventId, () => {
  closePreview()
  generation++
  controller?.abort()
  captures.value = []
  error.value = ''
  more.value = false
  busy.value = false
  expanded.value = false
  clearInterval(timer)
  load()
  timer = setInterval(() => { if (!document.hidden && !expanded.value) load() }, 5000)
}, { immediate: true })
watch(() => props.latestCapture?.id, () => { if (!expanded.value) load() })
onBeforeUnmount(() => { generation++; controller?.abort(); clearInterval(timer); closePreview() })
</script>

<template>
  <section class="capture-section" aria-label="탐지 캡처">
    <h4>탐지 캡처</h4>
    <p class="capture-note">최초 확정 장면과 이후 탐지 중 영상 시간 기준 5초 간격 기록 · 사진을 클릭하면 확대</p>
    <button v-if="expanded" type="button" :disabled="busy" @click="load()">최신 캡처 보기</button>
    <p v-if="error" role="alert">{{ error }} <button type="button" @click="load()">다시 시도</button></p>
    <p v-else-if="!captures.length">{{ busy ? '캡처를 불러오는 중입니다.' : '아직 저장된 캡처가 없습니다.' }}</p>
    <div class="capture-grid">
      <button v-for="capture in displayed" :key="capture.id" type="button" @click="openPreview(capture)">
        <img :src="capture.image_url" :alt="`영상 ${timestamp(capture.video_time_ms)} 탐지 캡처`" loading="lazy">
        <span>영상 {{ timestamp(capture.video_time_ms) }}</span>
      </button>
    </div>
    <a v-if="previewLimit > 0 && (captures.length > previewLimit || more)" class="more-captures" :href="`/events/${eventId}`">더보기</a>
    <button v-else-if="previewLimit === 0 && more" type="button" :disabled="busy" @click="load(true)">더보기</button>
    <Teleport to="body">
      <dialog ref="previewDialog" class="capture-preview-dialog" aria-label="탐지 캡처 확대" @click.self="closePreview" @cancel.stop.prevent="closePreview" @keydown.esc.stop @close="!previewDialog?.open && (selectedCapture = null)">
        <div v-if="selectedCapture" class="capture-preview-content">
          <div class="capture-preview-heading">
            <strong>탐지 캡처 · 영상 {{ timestamp(selectedCapture.video_time_ms) }}</strong>
            <button type="button" autofocus @click="closePreview">닫기</button>
          </div>
          <img :src="selectedCapture.image_url" :alt="`영상 ${timestamp(selectedCapture.video_time_ms)} 탐지 캡처 확대`">
        </div>
      </dialog>
    </Teleport>
  </section>
</template>

<style scoped>
.capture-section { margin-top: 18px; }h4 { margin-bottom: 8px; }.capture-note { color: var(--text-3); font-size: 11px; line-height: 1.6; }
.capture-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin: 10px 0; }
.capture-grid button { padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); color: var(--text); cursor: pointer; }
.capture-grid img { display: block; width: 100%; aspect-ratio: 16/9; object-fit: contain; }.capture-grid span { display: block; padding: 7px; font-size: 12px; }
.more-captures { display: inline-block; padding: 7px 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--accent); text-decoration: none; }
.capture-preview-dialog { width: min(1200px, 94vw); max-width: 94vw; max-height: 92vh; padding: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--bg-2); color: var(--text); }
.capture-preview-dialog::backdrop { background: rgba(0, 0, 0, .8); }
.capture-preview-content { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.capture-preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.capture-preview-content img { display: block; width: 100%; max-height: 70vh; object-fit: contain; }
.capture-preview-content button { align-self: flex-end; padding: 7px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); color: var(--text); cursor: pointer; }
</style>
