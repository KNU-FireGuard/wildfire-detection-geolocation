// hls.js 치명적 오류의 원인 설명과 자동 복구 판단입니다. 영상 서버에 부담을 주지 않도록 횟수와 간격을 제한합니다.
export const MAX_NETWORK_RETRIES = 3
export const MAX_MEDIA_RECOVERIES = 2
export const RETRY_DELAY_MS = 10000

export function describeHlsError(data) {
  if (!data) return '알 수 없는 오류'
  if (data.response?.code) return `HTTP ${data.response.code}`
  if (/TimeOut/i.test(data.details ?? '')) return '응답 시간 초과'
  if (data.type === 'networkError') return '네트워크 오류'
  if (data.type === 'mediaError') return '재생 오류'
  return data.details || '알 수 없는 오류'
}

// state: 지금까지 시도한 횟수 { network, media }
export function decideRecovery(data, state) {
  if (data?.type === 'networkError' && state.network < MAX_NETWORK_RETRIES) {
    return { action: 'retry', delayMs: RETRY_DELAY_MS * (state.network + 1) }
  }
  if (data?.type === 'mediaError' && state.media < MAX_MEDIA_RECOVERIES) {
    return { action: 'recover', delayMs: 0 }
  }
  return { action: 'fail' }
}
