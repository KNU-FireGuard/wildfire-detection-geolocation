# AI 학습 결과

각 실험 폴더에 학습 가중치, `results.csv`, `args.yaml`, 검증 결과 이미지를 보관

## 실험 요약

성능은 각 `results.csv`에서 mAP50-95가 가장 높은 epoch의 검증 지표

| 모델 | 데이터와 학습 순서 | Epoch | 최고 epoch | Precision | Recall | mAP50 | mAP50-95 | 기록 시간 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `yolo26n_fire_50` | AI Hub 산불 데이터 | 50/50 | 50 | 84.8% | 73.4% | 80.6% | 50.3% | 9.2시간 |
| `yolo26n_fire_100` | AI Hub 산불 데이터, `fire_50`의 `last.pt`에서 이어 학습 | 100/100 | 100 | 85.1% | 75.2% | 82.2% | 52.0% | 15.8시간 |
| `yolo26s_merged` | AI Hub + CCTV | 78/100 | 78 | 85.6% | 76.8% | 84.4% | 56.9% | 39.8시간 |
| `yolo26n_merged_roboflow` | AI Hub + CCTV 학습 후 Roboflow 데이터로 추가 학습 | 83/150 | 58 | 52.2% | 50.1% | 45.4% | 24.4% | 8.7시간 |
| `yolo26n_roboflow` | Roboflow 데이터 | 150/150 | 147 | 54.4% | 50.6% | 45.1% | 25.8% | 15.7시간 |
| `yolo26n_roboflow_cctv` | Roboflow 학습 후 CCTV 데이터로 추가 학습 | 28/150 | 3 | 7.5% | 13.3% | 2.2% | 0.3% | 0.2시간 |

## 데이터 출처

- AI Hub 산불 데이터: [산불 발생 및 확산 데이터](https://aihub.or.kr/aihubdata/data/view.do?currMenu=115&topMenu=100&dataSetSn=71330)
- CCTV 데이터: 프로젝트에서 수집·정리한 CCTV 학습 데이터
- Roboflow 데이터: Roboflow에서 내려받은 학습 데이터
- `merged`: AI Hub와 CCTV 데이터 병합
- `merged_roboflow`: 병합 데이터 학습 후 Roboflow 데이터로 추가 학습
- `roboflow_cctv`: Roboflow 데이터 학습 후 CCTV 데이터로 추가 학습

## 참고

- 시간은 `results.csv` 마지막 행의 누적 `time` 초를 시간 단위로 환산
- Epoch는 실제 `results.csv` 기록 수이며, 분모는 `args.yaml`의 설정 epoch
- 서로 다른 검증 데이터의 지표는 직접 비교할 수 없음
- `yolo26n_roboflow_cctv`는 기록된 검증 지표가 낮아 결과 확인 필요
- `.pt` 파일은 Git LFS로 관리하므로 저장소를 내려받을 때 Git LFS 설치 필요
- `epoch*.pt`와 `last.pt`는 이어 학습·시점 비교를 위한 체크포인트이며, 추론에는 보통 `best.pt` 사용
