// 주소의 ?camera= 값을 목록에 있는 카메라 ID로 바꿉니다. 없거나 잘못된 값이면 null입니다.
export function findRequestedCameraId(value, cameras) {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  const id = Number(raw)
  return cameras.some(camera => camera.id === id) ? id : null
}
