// 좌표, 설치 위치, PTZ 값은 UI 개발용 임시 데이터이며 실제 CCTV 정보가 아닙니다.
// 향후 GET /api/cameras 응답으로 App.vue의 데이터 공급 부분을 교체합니다.
export const cameras = [
  { id: 'PGS-CAM-01', name: 'CAM 01', locationName: '팔공산 비로봉 능선', latitude: 36.0157, longitude: 128.6951, altitudeM: 850, status: 'ONLINE', ptzModel: 'P269-T13', panDeg: 124.6, tiltDeg: -5.8, zoom: 4.0, hfovDeg: 15.2, vfovDeg: 8.6 },
  { id: 'PGS-CAM-02', name: 'CAM 02', locationName: '팔공산 동쪽 능선', latitude: 36.0182, longitude: 128.7210, altitudeM: 780, status: 'ONLINE', ptzModel: 'P269-T13', panDeg: 210.0, tiltDeg: -8.0, zoom: 3.0, hfovDeg: 20.1, vfovDeg: 11.4 },
  { id: 'PGS-CAM-03', name: 'CAM 03', locationName: '팔공산 북쪽 전망대', latitude: 36.0340, longitude: 128.7060, altitudeM: 920, status: 'ONLINE', ptzModel: 'P269-T13', panDeg: 170.0, tiltDeg: -6.5, zoom: 2.0, hfovDeg: 30.0, vfovDeg: 17.0 },
  { id: 'PGS-CAM-04', name: 'CAM 04', locationName: '팔공산 서쪽 능선', latitude: 36.0310, longitude: 128.6800, altitudeM: 810, status: 'OFFLINE', ptzModel: 'P269-T13', panDeg: 95.0, tiltDeg: -4.0, zoom: 4.0, hfovDeg: 15.2, vfovDeg: 8.6 },
  { id: 'PGS-CAM-05', name: 'CAM 05', locationName: '팔공산 남서쪽 전망대', latitude: 35.9980, longitude: 128.6770, altitudeM: 650, status: 'ONLINE', ptzModel: 'P269-T13', panDeg: 40.0, tiltDeg: -3.5, zoom: 3.0, hfovDeg: 20.1, vfovDeg: 11.4 },
  { id: 'PGS-CAM-06', name: 'CAM 06', locationName: '팔공산 남쪽 탐방로', latitude: 35.9840, longitude: 128.6990, altitudeM: 560, status: 'OFFLINE', ptzModel: 'P269-T13', panDeg: 10.0, tiltDeg: -2.0, zoom: 2.0, hfovDeg: 30.0, vfovDeg: 17.0 },
  { id: 'PGS-CAM-07', name: 'CAM 07', locationName: '팔공산 남동쪽 능선', latitude: 35.9950, longitude: 128.7330, altitudeM: 710, status: 'ONLINE', ptzModel: 'P269-T13', panDeg: 300.0, tiltDeg: -7.0, zoom: 4.0, hfovDeg: 15.2, vfovDeg: 8.6 },
  { id: 'PGS-CAM-08', name: 'CAM 08', locationName: '팔공산 북동쪽 전망대', latitude: 36.0380, longitude: 128.7380, altitudeM: 880, status: 'OFFLINE', ptzModel: 'P269-T13', panDeg: 235.0, tiltDeg: -5.0, zoom: 3.0, hfovDeg: 20.1, vfovDeg: 11.4 },
]
