# YOLO26n 산불 탐지 모델

## 학습 정보

| 항목 | 값 |
| --- | --- |
| 작업 | 객체 탐지 |
| 모델 | YOLO26n |
| 클래스 | `0 smoke`, `1 fire` |
| 이미지 크기 | 640 × 640 |
| 배치 크기 | 16 |
| 학습 횟수 | 50 epoch |
| Optimizer | `auto` |
| 학습 장치 | CUDA GPU · Tesla T4 |
| 전체 이미지 | 57,479장 |
| 학습 / 검증 | 45,983장 / 11,496장 |

- 학습 당시 데이터셋 설정 경로: `/home/guest/fire_project/ai/data.yaml`
- 위 경로는 학습 환경의 경로이며 현재 프로젝트의 실행 파일 경로가 아님

## 50 epoch 학습 결과

| 지표 | 값 |
| --- | ---: |
| Precision | 0.8476 |
| Recall | 0.7344 |
| mAP@50 | 0.8060 |
| mAP@50-95 | 0.5034 |

## 파일

| 파일 | 용도 |
| --- | --- |
| `weights/yolo26s_final/weights/best.pt` | Backend 분석의 기본 가중치, `AI_MODEL_PATH`로 변경 가능 |
| `yolo26n_fire_50/weights/best.pt` | 초기 실험 모델의 최적 가중치 |
| `yolo26n_fire_50/weights/last.pt` | 마지막 epoch 가중치, 학습 재개용 |
| `inference/test.py` | 고정된 `ai/test.mp4`를 추론하는 독립 테스트 코드, Backend 연동용 CLI 아님 |
| `inference/backend_connect.py` | Backend가 실행하는 CLI, 탐지 JSON과 확정 JPEG 캡처 전송, `--capture-url` 미지정 시 기존 MJPEG 호환 모드 |
| `args.yaml` | 학습 설정 |
| `results.csv`, `results.png` | 학습 지표와 그래프 |
| `BoxF1_curve.png`, `BoxP_curve.png`, `BoxPR_curve.png`, `BoxR_curve.png` | 성능 곡선 |
| `confusion_matrix*.png` | 혼동 행렬 |
| `labels.jpg`, `train_batch*.jpg`, `val_batch*_labels.jpg`, `val_batch*_pred.jpg` | 데이터·예측 시각화 |

## Backend 연동

- Backend는 `inference/backend_connect.py`를 실행해 `run_id`, `camera_id`, 원본 영상 경로, 영상 업로드 URL, 탐지 결과 URL, 카메라 이름·위경도 전달
- 위치 추정: 첫 프레임에서 `location_session.py`로 자세를 1회 결정(`config/cameras.json` 고정 자세 우선, 없으면 능선 360° 역산), 이후 탐지마다 위경도 계산
- 위치 추정 준비 결과는 표준 출력에 `Location status: …` 1줄로 기록, 실패해도 탐지·영상 전송은 계속하고 위치는 `null`
- AI 콜백 인증은 Backend와 같은 `AI_CALLBACK_TOKEN` 환경변수 사용
- Python 패키지: `ultralytics`, `opencv-python`, `requests`, 위치 추정용 `numpy`, `scipy`, `Pillow`, `certifi`
- DEM 다운로드는 `certifi` 인증서 묶음으로 HTTPS를 검증, macOS python.org Python의 `CERTIFICATE_VERIFY_FAILED` 방지 (#68)
- 설치 명령은 프로젝트 [README](../README.md) 참고

## 실시간 CCTV 위치 추정

- `inference/live_runner.py`에서 Test와 같은 `LocationSession` 사용, 위경도가 있으면 `fixed_pose`가 없어도 능선·DEM 기반 자세 추정 실행
- 화각은 카메라 설정값 우선, 없으면 기본 60°와 `FOV_DEFAULT_USED` 경고, 기존 54°·66° 대체 자세로 오차 범위 평가
- 확정 탐지를 위치 없이 먼저 전송하고 별도 작업자가 위치 보완, DEM·자세 준비 실패가 탐지와 heartbeat를 막지 않음
- 준비 실패는 30·60·120·240·300초 간격으로 최신 프레임 재시도, 이후 최대 300초 간격 유지, 위경도 없음은 생략
- 큰 장면 변화·해상도 변경·재접속 뒤 연속 10프레임·1.8초 이상 안정 시 이전 고정 자세를 재사용하지 않고 재추정, 단순 프레임 누락에는 같은 자세 유지
- 준비 상태는 `[live camera=…] location_ready=… mode=… reason=… warnings=… retry_in_s=…` 로그로 확인
- 점진적인 PTZ·줌 변화의 완전한 감지와 실제 카메라 화각 자동 측정은 미지원

## 위치 추정 테스트

- 저장소 루트에서 실행

```bash
python3 -m unittest ai/test_geolocation.py
```

- DEM 타일 캐시 `ai/.dem_cache/`(Git 제외)가 없으면 Terrarium 로더 테스트 1개는 건너뜀, 나머지는 네트워크 없이 실행
- 타일 캐시는 위치 추정을 처음 실행할 때 자동으로 내려받음
- 영상·JSON 형식과 인증 헤더는 [API 명세](../docs/API_SPEC.md) 참고
- 추론 프레임은 원본 영상 FPS에 맞춰 대기하지 않고 모델 처리 속도로 전송

## 관련 연구

- [산불 위치 추정 알고리즘 선행 연구 및 오차 분석 (Notion)](https://app.notion.com/p/3ea07da378308006b5c6ef31d8a83fd3?source=copy_link)
