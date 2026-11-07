<script setup>
import { onBeforeUnmount, ref, watch, useId } from 'vue'
const props = defineProps({ open: { type: Boolean, default: false }, title: { type: String, required: true }, busy: { type: Boolean, default: false } })
const emit = defineEmits(['close'])
const dialog = ref(null)
const titleId = useId()
let previousOverflow = null
function restore() {
  if (previousOverflow !== null) { document.body.style.overflow = previousOverflow; previousOverflow = null }
}
watch([dialog, () => props.open], ([element, open]) => {
  if (!element) return
  if (open && !element.open) {
    element.showModal()
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else if (!open && element.open) { element.close(); restore() }
}, { flush: 'post' })
function close() { if (!props.busy) emit('close') }
function cancel(event) { event.preventDefault(); close() }
onBeforeUnmount(() => { dialog.value?.close(); restore() })
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="record-dialog" :aria-labelledby="titleId" @cancel="cancel">
      <header><h2 :id="titleId">{{ title }}</h2><button type="button" :disabled="busy" aria-label="팝업 닫기" @click="close">×</button></header>
      <slot />
      <footer><slot name="actions" /><button type="button" :disabled="busy" @click="close">닫기</button></footer>
    </dialog>
  </Teleport>
</template>
<style scoped>
.record-dialog { width: min(580px, calc(100vw - 32px)); max-height: calc(100dvh - 40px); overflow-y: auto; box-sizing: border-box; padding: 24px; border: 1px solid var(--line-strong); border-radius: 16px; background: var(--surface); color: var(--text); }
.record-dialog::backdrop { background: #03080dbb; }header, footer { display: flex; align-items: center; gap: 12px; }header { justify-content: space-between; margin-bottom: 20px; }h2 { margin: 0; font-size: 20px; }footer { justify-content: flex-end; margin-top: 22px; }button { padding: 7px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); color: var(--text); cursor: pointer; }
</style>
