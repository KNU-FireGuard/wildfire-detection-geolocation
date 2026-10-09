async function request(path, { method = 'GET', body, token, signal } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 15000)
  try {
    const response = await fetch(`/api${path}`, {
      method, signal: controller.signal,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (response.status === 204) return null
    let data
    try { data = await response.json() } catch {
      if (response.ok) throw new Error('API 응답 형식이 올바르지 않습니다.')
    }
    if (!response.ok) {
      const message = typeof data?.error === 'string' ? data.error : response.status === 404
        ? 'API 또는 조회 대상이 없습니다. 백엔드 구현·연결 상태를 확인하세요. (HTTP 404)'
        : `요청 실패 (HTTP ${response.status})`
      throw Object.assign(new Error(message), { status: response.status })
    }
    return data
  } catch (error) {
    if (controller.signal.aborted) throw new Error('요청이 취소되었거나 조회 시간이 초과되었습니다.')
    throw error
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}
function validRun(data, requireVideos = false) {
  if (!validId(data?.id) || !['running', 'completed', 'completed_with_errors', 'failed'].includes(data.status)) throw new Error('실행 상태 응답이 올바르지 않습니다.')
  if (requireVideos && (data.status !== 'running' || !Array.isArray(data.videos) || data.videos.length !== 4 || data.videos.some(v => !validId(v?.camera_id) || !validId(v.video_id) || v.stream_url !== `/api/videos/${v.video_id}/stream`) || new Set(data.videos.map(v => v.camera_id)).size !== 4 || new Set(data.videos.map(v => v.video_id)).size !== 4)) throw new Error('영상 응답 형식이 올바르지 않습니다.')
  if (!requireVideos && (!Array.isArray(data.cameras) || data.cameras.length !== 4 || data.cameras.some(c => !validId(c?.camera_id) || !['running', 'completed', 'failed'].includes(c.status) || (c.error !== null && typeof c.error !== 'string')) || new Set(data.cameras.map(c => c.camera_id)).size !== 4)) throw new Error('카메라 상태 응답이 올바르지 않습니다.')
  return data
}
const validId = value => Number.isInteger(value) && value > 0 && value <= 2147483647
export const startDemo = async (token, options = {}) => validRun(await request('/demo-runs', { method: 'POST', token, ...options }), true)
export const getDemo = async (id, token, options = {}) => {
  const result = validRun(await request(`/demo-runs/${id}`, { token, ...options }))
  if (result.id !== id) throw new Error('조회한 실행 상태 응답의 ID가 일치하지 않습니다.')
  return result
}
export const login = (username, password) => request('/auth/login', { method: 'POST', body: { username, password } })
export const getMe = token => request('/auth/me', { token })
export const recipients = {
  list: async token => {
    const result = await request('/sms-recipients', { token })
    if (!Array.isArray(result?.items) || result.items.some(item => !validId(item?.id) || typeof item.name !== 'string' || typeof item.phone_number !== 'string' || typeof item.is_active !== 'boolean')) throw new Error('수신자 API 응답 형식이 올바르지 않습니다.')
    return result
  },
  create: (body, token) => request('/sms-recipients', { method: 'POST', body, token }),
  update: (id, body, token) => request(`/sms-recipients/${id}`, { method: 'PATCH', body, token }),
  remove: (id, token) => request(`/sms-recipients/${id}`, { method: 'DELETE', token }),
}
