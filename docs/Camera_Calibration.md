# 카메라 보정 도구

- 목적: 실제 프레임의 산능선과 지도 랜드마크로 카메라 화각·자세를 구해 `ai/config/cameras.json` 항목(ADR 0018)을 생성
- 구현: `ai/camera_calibration.py`, 실행 `python3 -m ai.calibrate_camera <작업 파일>`
- 위치(위경도)는 DB 값으로 고정하고 추정하지 않음, 화각과 화면별 자세만 구함

## 보정 작업 파일

- 위치: `ai/config/calibration_jobs/<카메라 키>.json` (Git 저장)
- 프레임 이미지는 `data/` 아래에 두고 경로만 기록 (Git 제외, 재검증하려면 같은 프레임 필요)
- 랜드마크는 카메라당 한 번 측정하면 재검증에 계속 사용, 카메라가 틀어지거나 줌·프리셋이 바뀌면 픽셀 위치만 다시 표시

```json
{
  "version": 1,
  "camera": {"key": "gachang-ori", "name": "가창오리", "camera_id": null, "lat": 35.791037, "lon": 128.591184, "tower_height_m": 15.0},
  "fov_search_deg": [35.0, 75.0],
  "fov_step_deg": 1.0,
  "views": [
    {"id": "P339/T03", "frame": "data/frames/check/t195.png", "preset": "P339/T03", "label_pan": 339.0}
  ],
  "landmarks": [
    {"name": "A 빨간 지붕 집", "lat": 35.79112, "lon": 128.59199, "height_m": 6.0, "view": "P339/T03", "px": [600, 875], "use": "fit"},
    {"name": "E 흰 2층 건물", "lat": 35.79035, "lon": 128.59383, "height_m": 7.0, "view": "P339/T03", "px": [1200, 905], "use": "val"}
  ]
}
```

| 항목 | 의미 |
| :--- | :--- |
| `camera.lat`·`lon` | DB `cameras` 위경도 |
| `views[].preset` | PTZ 프리셋 라벨, 고정 카메라는 생략 |
| `views[].label_pan` | 라벨의 Pan 값, 있으면 Pan 오프셋 계산 |
| `landmarks[].use` | `fit`은 보정에 사용, `val`은 보정에 쓰지 않고 오차만 보고 |
| `landmarks[].height_m` | 지면 위 높이 (지붕 등) |

## 절차

1. 화면마다 산능선 추출 (`SkylineExtractor`)
2. 기준 화각에서 화면별 360° 역산으로 Pan 시작값 결정 (#56 게이트)
3. 화각 탐색 범위의 각 화각에서 화면별 자세를 정식 회전 모델로 추정, 보정용(`fit`) 랜드마크가 있으면 오차에 포함
4. 전체 오차가 가장 작은 화각 선택, 최소값의 10% 이내인 화각 구간을 불확실성으로 보고
5. 검증용(`val`) 랜드마크로 방향 오차(°)와 옆 방향 거리 오차(m) 계산
6. 설정 후보 항목과 리포트 생성, `--apply`를 줄 때만 `ai/config/cameras.json`에 반영

## 경고

| 코드 | 조건 | 의미 |
| :--- | :--- | :--- |
| `NO_LANDMARKS` | 보정용 랜드마크 없음 | 능선만으로 화각을 정함, 독립 검증 없음 |
| `NO_VALIDATION_LANDMARKS` | 검증용 랜드마크 없음 | 결과 정확도를 독립적으로 확인할 수 없음 |
| `FOV_ILL_CONSTRAINED` | 최소 오차 10% 이내 화각 구간이 6° 이상 | 화각이 정해지지 않음, 등록 비권장 |
| `POSITION_UNCONSTRAINED` | 보정용 랜드마크 방위 분포가 60° 미만 | 위치·높이 오차를 구분할 수 없음 (#51 가창 사례) |
| `PAN_OFFSET_INCONSISTENT` | 프리셋별 Pan 오프셋 범위 3° 초과 | 라벨 변환 신뢰 낮음 |
| `VIEW_FAILED` | 화면의 능선 추출 또는 자세 추정 실패 | 해당 화면 제외 |

## 한계

- 카메라 위치·눈높이는 추정하지 않음 (랜드마크 분포가 한쪽에 몰리면 분리 불가)
- 렌즈 왜곡 미반영, 줌이 바뀌면 화각이 달라지므로 다시 보정
