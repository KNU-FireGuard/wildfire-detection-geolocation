import { onBeforeUnmount, ref, watch } from 'vue'
export function useQuery(key, query) {
  const data = ref(null), loading = ref(false), error = ref('')
  let controller
  async function reload() {
    controller?.abort()
    const current = new AbortController()
    controller = current
    loading.value = true
    error.value = ''
    data.value = null
    const timeout = setTimeout(() => current.abort(), 15000)
    try {
      const result = await query(current.signal)
      if (controller === current) data.value = result
    } catch (cause) {
      if (controller === current) error.value = current.signal.aborted ? '조회 시간이 초과되었습니다. 다시 시도해주세요.' : cause.message
    } finally {
      clearTimeout(timeout)
      if (controller === current) loading.value = false
    }
  }
  watch(key, reload, { immediate: true })
  onBeforeUnmount(() => { controller?.abort(); controller = null })
  return { data, loading, error, reload }
}
