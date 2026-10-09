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
| `yolo26n_fire_50/weights/best.pt` | 성능 기준 최적 가중치, 추론에 사용 |
| `yolo26n_fire_50/weights/last.pt` | 마지막 epoch 가중치, 학습 재개용 |
| `args.yaml` | 학습 설정 |
| `results.csv`, `results.png` | 학습 지표와 그래프 |
| `BoxF1_curve.png`, `BoxP_curve.png`, `BoxPR_curve.png`, `BoxR_curve.png` | 성능 곡선 |
| `confusion_matrix*.png` | 혼동 행렬 |
| `labels.jpg`, `train_batch*.jpg`, `val_batch*_labels.jpg`, `val_batch*_pred.jpg` | 데이터·예측 시각화 |

## 시스템 연동 계획

- 현재는 학습 결과와 가중치만 있으며 영상 추론 실행 코드 없음
- Backend가 Test 버튼 한 번에 영상 4개의 파일 경로와 카메라 ID를 Python 추론 코드에 전달
- `ai/infer.py`가 영상을 재생 시간에 맞춰 병행 처리하고 탐지 결과를 Backend에 전송할 계획
- AI 결과 형식은 [API 명세의 목표 JSON](../docs/API_SPEC.md) 기준
- `fire`와 `smoke` 모두 전송, 화점 위치를 추정하지 못하면 `location_estimation: null`
- Frontend 프레임 업로드와 별도 AI FastAPI 서버는 현재 계획에 없음
- Backend가 결과를 받은 현재 시각을 탐지 시각으로 기록, 과거 영상 촬영 시각은 사용하지 않음
- 4개 영상 동시 추론 성능과 전송 주기는 실제 실행 서버에서 검증 필요
