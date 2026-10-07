// 화면 개발용 임시 데이터이며 Backend 응답 규격이 아닙니다.
export const events = [
  { id: 1, cameraId: 'PGS-CAM-01', cameraName: 'CAM 01', detectedAt: '2026-10-07T14:30:00+09:00', type: 'smoke', confidence: 0.93, location: { latitude: 36.0157, longitude: 128.6951 }, estimatedAddress: '대구 동구 용수동 산 1-1', status: 'UNCONFIRMED' },
  { id: 2, cameraId: 'PGS-CAM-02', cameraName: 'CAM 02', detectedAt: '2026-10-07T14:35:00+09:00', type: 'fire', confidence: 0.97, location: { latitude: 36.0082, longitude: 128.7196 }, estimatedAddress: '대구 동구 도학동 산 일대 (임시)', status: 'CONFIRMED' },
  { id: 3, cameraId: 'PGS-CAM-03', cameraName: 'CAM 03', detectedAt: '2026-10-07T14:40:00+09:00', type: 'smoke', confidence: 0.81, location: null, estimatedAddress: null, status: 'UNCONFIRMED' },
]
