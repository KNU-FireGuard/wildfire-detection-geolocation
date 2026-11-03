// 이벤트 목록에서 카메라 ID를 사람이 읽는 이름으로 바꿉니다.
export function cameraName(cameraId, cameras) {
  return cameras.find(camera => camera.id === cameraId)?.name ?? (cameraId == null ? '카메라 정보 없음' : `카메라 ${cameraId}`)
}
