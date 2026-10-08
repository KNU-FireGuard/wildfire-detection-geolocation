let pending
export const AUTH_ERROR_EVENT = 'fireguard-naver-auth-error'

export function loadNaverMaps(clientId) {
  if (!clientId?.trim()) return Promise.reject(new Error('네이버 지도가 아직 설정되지 않았습니다.'))
  if (window.naver?.maps?.Map) return Promise.resolve(window.naver.maps)
  if (pending) return pending
  pending = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    let finished = false
    const previousAuthFailure = window.navermap_authFailure
    const authFailure = () => {
      window.dispatchEvent(new Event(AUTH_ERROR_EVENT))
      fail('네이버 지도 인증에 실패했습니다. 지도 서비스 설정을 확인해주세요.')
      previousAuthFailure?.()
    }
    window.navermap_authFailure = authFailure
    const timer = setTimeout(() => fail('네이버 지도 연결 시간이 초과되었습니다.'), 15000)
    function fail(message) {
      if (finished) return
      finished = true
      clearTimeout(timer)
      script.remove()
      if (window.navermap_authFailure === authFailure) window.navermap_authFailure = previousAuthFailure
      reject(new Error(message))
    }
    script.async = true
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId.trim())}`
    script.onerror = () => fail('네이버 지도를 불러오지 못했습니다. 네트워크 연결을 확인해주세요.')
    script.onload = () => {
      if (finished) return
      if (!window.naver?.maps?.Map) return fail('네이버 지도 인증 또는 로딩에 실패했습니다.')
      finished = true
      clearTimeout(timer)
      resolve(window.naver.maps)
    }
    document.head.appendChild(script)
  }).catch(error => { pending = undefined; throw error })
  return pending
}
