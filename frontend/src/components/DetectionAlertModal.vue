<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import DashboardIcon from './DashboardIcon.vue'
import { cameraName } from '../utils/cameraName'
import { formatConfidence, formatDetectedAt, formatType } from '../utils/eventFormat'

const props = defineProps({
  events: { type: Array, required: true },
  cameras: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['open', 'dismiss', 'acknowledge'])
const dialog = ref(null)
const count = computed(() => props.events.length)
const hasFire = computed(() => props.events.some(event => event.type === 'fire'))
const hasSmoke = computed(() => props.events.some(event => event.type === 'smoke'))
const alertLabel = computed(() => hasFire.value && hasSmoke.value ? '화재·연기' : hasFire.value ? '화재' : '연기')
const title = computed(() => hasFire.value && hasSmoke.value ? '화재와 연기가 감지되었습니다' : hasFire.value ? '화재가 감지되었습니다' : '연기가 감지되었습니다')
let previousOverflow = null

function restoreScroll() {
  if (previousOverflow !== null) {
    document.body.style.overflow = previousOverflow
    previousOverflow = null
  }
}
watch([dialog, count], ([element, total]) => {
  if (!element) return
  if (total && !element.open) {
    element.showModal()
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else if (!total && element.open) {
    element.close()
    restoreScroll()
  }
}, { flush: 'post' })
function dismiss() { if (!props.busy) emit('dismiss') }
function cancel(event) { event.preventDefault(); dismiss() }
function confirm() { if (!props.busy) emit('acknowledge', props.events.map(event => event.id)) }
onBeforeUnmount(() => { dialog.value?.close(); restoreScroll() })
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="detection-alert-modal" :class="{ 'smoke-alert': !hasFire }" role="alertdialog" aria-modal="true" aria-labelledby="detection-alert-title" aria-describedby="detection-alert-description" @cancel="cancel">
      <template v-if="count">
        <header class="alert-heading">
          <span class="alert-symbol"><DashboardIcon :name="hasFire ? 'fire' : 'smoke'" :size="34" /></span>
          <div aria-live="polite"><p class="alert-eyebrow">새 {{ alertLabel }} 알림</p><h2 id="detection-alert-title">{{ title }}</h2></div>
          <button type="button" class="close-alert" :aria-label="`${alertLabel} 알림 팝업 닫기`" :disabled="busy" @click="dismiss">×</button>
        </header>
        <div class="alert-content">
          <p id="detection-alert-description">탐지 카메라를 확인하고 지도에서 현장을 살펴보세요.</p>
          <p class="alert-count" aria-live="polite">새로 수신한 {{ alertLabel }} <strong>{{ count }}건</strong></p>
          <ul class="alert-events">
            <li v-for="(event, index) in events" :key="event.id">
              <a v-if="event.latestCapture" :href="`/events/${event.id}`" class="capture-preview">
                <img :src="event.latestCapture.image_url" :alt="`영상 ${(event.latestCapture.video_time_ms / 1000).toFixed(1)}초 확정 탐지 캡처`">
                <span>영상 {{ (event.latestCapture.video_time_ms / 1000).toFixed(1) }}초</span>
              </a>
              <div class="alert-camera"><span class="camera-icon"><DashboardIcon name="camera" :size="23" /></span><div><span class="event-type" :class="event.type"><DashboardIcon :name="event.type" :size="13" />{{ formatType(event.type) }}</span><strong>{{ cameraName(event.cameraId, cameras) }}</strong><time :datetime="event.detectedAt">{{ formatDetectedAt(event.detectedAt) }} KST</time><span class="alert-confidence">AI 신뢰도 {{ formatConfidence(event.confidence) }}</span></div></div>
              <button type="button" class="view-event" :autofocus="index === 0" :disabled="busy" @click="emit('open', event.id)">지도에서 보기 <span aria-hidden="true">↗</span></button>
            </li>
          </ul>
          <p v-if="error" class="alert-error" role="alert">{{ error }}</p>
          <p class="alert-note">팝업을 닫아도 이벤트는 확인 대기 상태로 유지됩니다.</p>
        </div>
        <footer class="alert-footer">
          <button type="button" class="later-button" :disabled="busy" @click="dismiss">나중에 확인</button>
          <button type="button" class="confirm-detection" :disabled="busy" @click="confirm">{{ busy ? '확인 처리 중…' : count > 1 ? `전체 ${count}건 확인` : '확인 완료' }}</button>
        </footer>
      </template>
    </dialog>
  </Teleport>
</template>

<style scoped>
.capture-preview { display: block; width: 140px; flex-shrink: 0; color: var(--text); font-size: 11px; }.capture-preview img { width: 100%; display: block; border-radius: 6px; }
.detection-alert-modal { --alert-color: var(--fire, #ff6a57); --alert-rgb: 255,106,87; width: min(680px, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 40px); padding: 0; border: 1px solid rgba(var(--alert-rgb),.55); border-radius: 20px; background: var(--surface, #151f2d); color: var(--text, #f4f7fc); box-shadow: 0 24px 100px #000b; }
.detection-alert-modal.smoke-alert { --alert-color: var(--warn, #f6bd4a); --alert-rgb: 246,189,74; }
.detection-alert-modal[open] { display: flex; flex-direction: column; animation: alert-enter .16s ease-out; }
.detection-alert-modal::backdrop { background: rgba(3,8,15,.78); backdrop-filter: blur(5px); }
.event-type { display: inline-flex; align-items: center; gap: 4px; margin-bottom: 6px; font-size: 11px; font-weight: 700; }
.event-type.fire { color: var(--fire, #ff6a57); }.event-type.smoke { color: var(--warn, #f6bd4a); }
.alert-heading { display: flex; align-items: center; gap: 16px; padding: 28px 28px 24px; border-bottom: 1px solid var(--line, #ffffff16); background: linear-gradient(115deg, rgba(var(--alert-rgb),.10), transparent); }
.alert-symbol { display: grid; place-items: center; flex-shrink: 0; width: 64px; height: 64px; border: 1px solid rgba(var(--alert-rgb),.33); border-radius: 18px; background: rgba(var(--alert-rgb),.13); color: var(--alert-color); }
.alert-eyebrow { margin: 0 0 6px; color: var(--alert-color); font-size: 12px; font-weight: 750; letter-spacing: .8px; }h2 { margin: 0; font-size: clamp(21px, 3vw, 27px); font-weight: 800; letter-spacing: -.8px; }
.close-alert { align-self: flex-start; margin-left: auto; padding: 0; width: 30px; height: 30px; flex-shrink: 0; border: 0; border-radius: 8px; background: transparent; color: var(--text-3, #9baabe); font-size: 27px; line-height: 1; }
.alert-content { padding: 22px 28px; overflow-y: auto; }#detection-alert-description { margin: 0 0 20px; color: var(--text-2, #b5c0ce); font-size: 14px; line-height: 1.6; }.alert-count { margin: 0 0 10px; color: var(--text-3, #9baabe); font-size: 12px; }.alert-count strong { margin-left: 4px; color: var(--alert-color); }
.alert-events { display: grid; gap: 10px; list-style: none; margin: 0; padding: 0; }.alert-events li { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px; border: 1px solid var(--line, #ffffff16); border-radius: 12px; background: var(--surface-2, #1b2839); }
.alert-camera { display: flex; align-items: center; gap: 12px; min-width: 0; }.camera-icon { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 40px; border-radius: 11px; background: rgba(var(--alert-rgb),.08); color: var(--alert-color); }.alert-camera strong { display: block; font-size: 15px; overflow-wrap: anywhere; }.alert-camera time { display: block; margin-top: 6px; color: var(--text-3, #9baabe); font-size: 11px; }.alert-confidence { display: block; margin-top: 4px; color: var(--text-2, #b5c0ce); font-size: 11px; }
button { cursor: pointer; font-family: inherit; transition: background .15s, opacity .15s; }button:focus-visible { outline: 3px solid var(--accent, #55a9ff); outline-offset: 3px; }button:disabled { cursor: wait; opacity: .55; }.view-event { flex-shrink: 0; padding: 9px 11px; border: 1px solid var(--line-strong, #ffffff30); border-radius: 8px; background: transparent; color: var(--text, #f4f7fc); font-size: 12px; }.view-event:hover { background: #ffffff0a; }.view-event span { margin-left: 4px; }
.alert-note { margin: 16px 0 0; color: var(--text-3, #9baabe); font-size: 11px; line-height: 1.6; }.alert-error { padding: 12px; margin: 16px 0 0; border: 1px solid rgba(var(--alert-rgb),.33); border-radius: 8px; color: var(--alert-color); font-size: 13px; }
.alert-footer { display: flex; justify-content: flex-end; gap: 10px; flex-shrink: 0; padding: 18px 28px; border-top: 1px solid var(--line, #ffffff16); background: #00000010; }.alert-footer button { padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 650; }.later-button { border: 1px solid var(--line-strong, #ffffff30); color: var(--text-2, #b5c0ce); background: transparent; }.confirm-detection { min-width: 150px; border: 1px solid var(--alert-color); background: var(--alert-color); color: #1a0703; }.confirm-detection:hover { filter: brightness(1.08); }
@keyframes alert-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 520px) { .alert-heading { padding: 20px; gap: 12px; }.alert-symbol { width: 48px; height: 48px; border-radius: 13px; }.alert-content { padding: 18px; }.alert-events li { flex-direction: column; align-items: stretch; }.view-event { align-self: flex-end; }.alert-footer { padding: 16px 18px; }.alert-footer button { flex: 1; min-width: 0; padding: 12px 10px; } }
@media (prefers-reduced-motion: reduce) { .detection-alert-modal[open] { animation: none; } }
</style>
