// 요약 카드의 "운영 중인 CCTV" 집계입니다.
// - 카메라에 상태 값이 있으면(개발용 예시 데이터) ONLINE 개수와 전체 개수
// - 상태 값이 없으면(실제 API) Test 카메라를 제외하고, 영상 주소가 연결된 실시간 CCTV 개수와 전체 실시간 CCTV 개수
// 영상 주소가 있다는 뜻이며 지금 실제로 재생되는지까지 확인한 값은 아닙니다.
export function summarizeOperatingCameras(cameras) {
  if (cameras.some(camera => camera.status != null)) {
    return { online: cameras.filter(camera => camera.status === 'ONLINE').length, total: cameras.length }
  }
  const live = cameras.filter(camera => camera.sourceType === 'live')
  return { online: live.filter(camera => camera.streamUrl).length, total: live.length }
}
