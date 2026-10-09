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
| `inference/test.py` | 고정된 `ai/test.mp4`를 추론하는 독립 테스트 코드, Backend 연동용 CLI 아님 |
| `args.yaml` | 학습 설정 |
| `results.csv`, `results.png` | 학습 지표와 그래프 |
| `BoxF1_curve.png`, `BoxP_curve.png`, `BoxPR_curve.png`, `BoxR_curve.png` | 성능 곡선 |
| `confusion_matrix*.png` | 혼동 행렬 |
| `labels.jpg`, `train_batch*.jpg`, `val_batch*_labels.jpg`, `val_batch*_pred.jpg` | 데이터·예측 시각화 |

## 시스템 연동 계획

- 현재 `inference/test.py`는 `ai/test.mp4`를 사용하는 독립 테스트 코드
- Backend 연동용 추론 코드는 아직 구현되지 않음
- 연동 시 Backend가 실행 ID를 만들고 `run_id`, `camera_id`, 영상 경로와 전송 주소를 AI 프로세스 인자로 전달
- AI는 실행 ID를 직접 생성하거나 코드에 고정하지 않음
- 영상·JSON 요청 형식과 인증 헤더는 [API 명세](../docs/API_SPEC.md) 참고
