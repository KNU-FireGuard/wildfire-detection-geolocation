import { shallowReactive } from 'vue'

// 지도 아래 실시간 CCTV 영상에서 재생 중인 video 요소를 카메라 ID로 보관합니다.
// 우측 패널이 같은 영상을 공유해 영상 서버에 두 번째 연결을 열지 않도록 하기 위한 저장소입니다.
const videos = shallowReactive(new Map())

export function registerLiveVideo(cameraId, element) {
  videos.set(cameraId, element)
}

// 이미 다른 요소로 다시 등록된 경우에는 새 등록을 지우지 않습니다.
export function unregisterLiveVideo(cameraId, element) {
  if (videos.get(cameraId) === element) videos.delete(cameraId)
}

export function getLiveVideo(cameraId) {
  return videos.get(cameraId) ?? null
}
