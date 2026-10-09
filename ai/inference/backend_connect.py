import argparse
import os
from pathlib import Path

import requests
from ultralytics import YOLO


AI_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = AI_DIR / "yolo26n_fire_50" / "weights" / "best.pt"
BOUNDARY = "frame"


def parse_args():
    parser = argparse.ArgumentParser(description="FireGuard YOLO inference callback runner")
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--camera-id", type=int, required=True)
    parser.add_argument("--source-path", type=Path, required=True)
    parser.add_argument("--video-url", required=True, help="Annotated MJPEG upload URL")
    parser.add_argument("--result-url", required=True, help="Detection JSON API URL")
    parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument("--iou", type=float, default=0.45)
    parser.add_argument("--image-size", type=int, default=640)
    args = parser.parse_args()

    if args.run_id <= 0 or args.camera_id <= 0:
        parser.error("--run-id and --camera-id must be positive integers")
    if not args.source_path.is_file():
        parser.error(f"Video file not found: {args.source_path}")
    if not args.model_path.is_file():
        parser.error(f"Model file not found: {args.model_path}")
    if not 0 <= args.confidence <= 1 or not 0 <= args.iou <= 1:
        parser.error("--confidence and --iou must be between 0 and 1")
    if args.image_size <= 0:
        parser.error("--image-size must be positive")
    return args


def detection_payload(run_id, camera_id, class_name, confidence, coordinates):
    x1, y1, x2, y2 = coordinates
    return {
        "run_id": run_id,
        "camera_id": camera_id,
        "detection": {
            "class": class_name,
            "confidence": round(float(confidence), 4),
            "bbox": {
                "x1": round(float(x1), 2),
                "y1": round(float(y1), 2),
                "x2": round(float(x2), 2),
                "y2": round(float(y2), 2),
            },
        },
        "location_estimation": None,
    }


def iter_annotated_frames(model, args, headers, detection_count):
    import cv2

    results = model.predict(
        source=str(args.source_path),
        conf=args.confidence,
        iou=args.iou,
        imgsz=args.image_size,
        stream=True,
        save=False,
        show=False,
        verbose=False,
    )

    for result in results:
        if result.boxes is not None:
            for box in result.boxes:
                class_id = int(box.cls.item())
                class_name = str(model.names[class_id]).lower()
                if class_name not in {"fire", "smoke"}:
                    continue

                payload = detection_payload(
                    run_id=args.run_id,
                    camera_id=args.camera_id,
                    class_name=class_name,
                    confidence=box.conf.item(),
                    coordinates=box.xyxy[0].tolist(),
                )
                response = requests.post(
                    args.result_url,
                    headers=headers,
                    json=payload,
                    timeout=(5, 30),
                )
                response.raise_for_status()
                detection_count[0] += 1

        annotated_frame = result.plot()
        encoded, jpeg = cv2.imencode(".jpg", annotated_frame)
        if not encoded:
            raise RuntimeError("Failed to encode an annotated frame")

        jpeg_bytes = jpeg.tobytes()
        part_header = (
            f"--{BOUNDARY}\r\n"
            "Content-Type: image/jpeg\r\n"
            f"Content-Length: {len(jpeg_bytes)}\r\n"
            "\r\n"
        ).encode("ascii")
        yield part_header + jpeg_bytes + b"\r\n"

    yield f"--{BOUNDARY}--\r\n".encode("ascii")


def main():
    args = parse_args()
    token = os.environ.get("AI_CALLBACK_TOKEN")
    if not token:
        raise RuntimeError("AI_CALLBACK_TOKEN environment variable is required")

    headers = {"X-AI-Token": token}
    model = YOLO(str(args.model_path))
    detection_count = [0]

    response = requests.post(
        args.video_url,
        headers={
            **headers,
            "Content-Type": f"multipart/x-mixed-replace; boundary={BOUNDARY}",
        },
        data=iter_annotated_frames(model, args, headers, detection_count),
        timeout=(10, None),
    )
    response.raise_for_status()

    print(f"Run ID: {args.run_id}")
    print(f"Camera ID: {args.camera_id}")
    print(f"Annotated stream sent: {args.video_url}")
    print(f"Detections sent: {detection_count[0]}")


if __name__ == "__main__":
    main()
