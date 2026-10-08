// 위치와 주소는 UI 개발용 임시 데이터이며 실제 탐지 결과가 아닙니다.
// Camera 정보는 cameraId로 참조합니다. 향후 GET /api/events 응답으로 교체합니다.
export const events = [
  { id: 1, cameraId: 'PGS-CAM-01', detectedAt: '2026-10-07T14:30:00+09:00', type: 'smoke', confidence: 0.93, estimatedLocation: { latitude: 36.0089, longitude: 128.7118, address: '대구 동구 용수동 산 1-1 (임시)', errorRadiusM: 50 }, status: 'UNCONFIRMED' },
  { id: 2, cameraId: 'PGS-CAM-02', detectedAt: '2026-10-07T14:35:00+09:00', type: 'fire', confidence: 0.97, estimatedLocation: { latitude: 36.0010, longitude: 128.7240, address: '대구 동구 도학동 산 일대 (임시)', errorRadiusM: 80 }, status: 'CONFIRMED' },
  { id: 3, cameraId: 'PGS-CAM-03', detectedAt: '2026-10-07T14:40:00+09:00', type: 'smoke', confidence: 0.81, estimatedLocation: null, status: 'UNCONFIRMED' },
  { id: 4, cameraId: 'PGS-CAM-01', detectedAt: '2026-10-07T14:45:00+09:00', type: 'smoke', confidence: 0.89, estimatedLocation: { latitude: 36.0230, longitude: 128.6900, address: '팔공산 서쪽 능선 일대 (임시)', errorRadiusM: 65 }, status: 'UNCONFIRMED' },
]
