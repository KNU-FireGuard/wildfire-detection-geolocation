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
| `inference/backend_connect.py` | Backend가 실행하는 CLI, MJPEG 영상과 탐지 JSON 전송 |
| `args.yaml` | 학습 설정 |
| `results.csv`, `results.png` | 학습 지표와 그래프 |
| `BoxF1_curve.png`, `BoxP_curve.png`, `BoxPR_curve.png`, `BoxR_curve.png` | 성능 곡선 |
| `confusion_matrix*.png` | 혼동 행렬 |
| `labels.jpg`, `train_batch*.jpg`, `val_batch*_labels.jpg`, `val_batch*_pred.jpg` | 데이터·예측 시각화 |

## Backend 연동

- Backend는 `inference/backend_connect.py`를 실행해 `run_id`, `camera_id`, 원본 영상 경로, 영상 업로드 URL, 탐지 결과 URL 전달
- AI 콜백 인증은 Backend와 같은 `AI_CALLBACK_TOKEN` 환경변수 사용
- Python 패키지: `ultralytics`, `opencv-python`, `requests`
- 설치 명령은 프로젝트 [README](../README.md) 참고
- 영상·JSON 형식과 인증 헤더는 [API 명세](../docs/API_SPEC.md) 참고
- 추론 프레임은 원본 영상 FPS에 맞춰 대기하지 않고 모델 처리 속도로 전송

## 관련 연구

- [산불 위치 추정 알고리즘 선행 연구 및 오차 분석 (Notion)](https://app.notion.com/p/3ea07da378308006b5c6ef31d8a83fd3?source=copy_link)
