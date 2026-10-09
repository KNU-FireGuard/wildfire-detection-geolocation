from pathlib import Path
from ultralytics import YOLO

# 프로젝트 경로
BASE_DIR = Path(__file__).resolve().parent.parent

# 학습된 best.pt 모델 경로
MODEL_PATH = BASE_DIR / "yolo26n_fire_50" / "weights" / "best.pt"

# 추론할 파일 경로

SOURCE = BASE_DIR / "test.mp4"

# 결과 저장 경로
PROJECT_DIR = BASE_DIR / "inference" / "results"


def main():
    model = YOLO(str(MODEL_PATH))

    print(f"모델 경로: {MODEL_PATH}")
    print(f"모델 로드 완료: {model.names}")

    results = model.predict(
        source=str(SOURCE),
        conf=0.25,          # confidence threshold
        iou=0.45,            # NMS IoU threshold
        imgsz=640,            # 입력 이미지 크기
        save=True,            # 결과 이미지/동영상 저장
        show=True,            # 결과 화면 표시
        project=str(PROJECT_DIR.parent),
        name="predict",
        exist_ok=True,
        verbose=True
    )

    # 탐지 결과 출력
    for result in results:
        print("\n탐지 결과")

        if result.boxes is None or len(result.boxes) == 0:
            print("탐지된 객체가 없습니다.")
            continue

        for box in result.boxes:
            cls_id = int(box.cls.item())
            confidence = float(box.conf.item())
            x1, y1, x2, y2 = box.xyxy[0].tolist()

            print(f"클래스: {model.names[cls_id]}")
            print(f"Confidence: {confidence:.4f}")
            print(
                f"Bounding Box: "
                f"({x1:.1f}, {y1:.1f}, {x2:.1f}, {y2:.1f})"
            )


if __name__ == "__main__":
    main()