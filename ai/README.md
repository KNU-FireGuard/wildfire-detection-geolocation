# YOLO26n Wildfire Detection

산불 객체 탐지를 위해 YOLO26n 모델을 학습한 결과입니다.

## Model

-   Model: YOLO26n
-   Task: Object Detection
-   Classes:
    -   `0`: smoke
    -   `1`: fire
-   Image size: 640 × 640
-   Batch size: 16
-   Epochs: 50
-   Optimizer: `auto`
-   Device: CUDA GPU (Tesla T4)
-   Dataset: `/home/guest/fire_project/ai/data.yaml`에 정의된 산불
    데이터셋

## Training Dataset

전체 이미지 57,479장을 8:2로 분할하여 학습/검증에 사용했습니다.

-   Train: 45,983 images
-   Validation: 11,496 images

## Training Result

50 epoch 학습 결과:

  Metric         Value
  ----------- --------
  Precision     0.8476
  Recall        0.7344
  mAP@50        0.8060
  mAP@50-95     0.5034

## Files

-   `args.yaml` --- 학습 당시 사용된 전체 Ultralytics 설정
-   `results.csv` --- epoch별 학습/검증 결과
-   `results.png` --- 학습 결과 그래프
-   `BoxF1_curve.png` --- F1-Confidence curve
-   `BoxP_curve.png` --- Precision-Confidence curve
-   `BoxPR_curve.png` --- Precision-Recall curve
-   `BoxR_curve.png` --- Recall-Confidence curve
-   `confusion_matrix.png` --- confusion matrix
-   `confusion_matrix_normalized.png` --- normalized confusion matrix
-   `labels.jpg` --- 데이터셋 라벨 분포 시각화
-   `train_batch*.jpg` --- 학습 배치 시각화
-   `val_batch*_labels.jpg` --- validation 정답 라벨 시각화
-   `val_batch*_pred.jpg` --- validation 예측 결과 시각화

### Weights

`weights/`에는 학습 가중치가 포함되어 있습니다.

-   `best.pt` --- validation 성능 기준 best model. **추론/배포에 사용**
-   `last.pt` --- 마지막 epoch의 model. **학습 재개 등에 사용**


``` yaml
data: /home/guest/fire_project/ai/data.yaml
```


