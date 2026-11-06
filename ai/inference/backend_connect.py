import argparse
import os
import queue
import threading
from pathlib import Path

import requests
import torch
from ultralytics import YOLO


AI_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = AI_DIR / "weights" / "yolo26s_final" / "weights" / "best.pt"
BOUNDARY = "frame"
FRAME_QUEUE_SIZE = 2


def pick_device():
    if torch.cuda.is_available():
        return "cuda:0"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


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
    parser.add_argument("--vid-stride", type=int, default=6, help="Analyze every Nth frame")
    parser.add_argument("--stream-width", type=int, default=960, help="Max width of streamed frames (0 = original)")
    parser.add_argument("--jpeg-quality", type=int, default=80)
    parser.add_argument("--device", default=None, help="cuda:0, mps, cpu (default: auto)")
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
    if args.vid_stride <= 0:
        parser.error("--vid-stride must be positive")
    if args.stream_width < 0:
        parser.error("--stream-width must be zero or positive")
    if not 1 <= args.jpeg_quality <= 100:
        parser.error("--jpeg-quality must be between 1 and 100")
    if args.device is None:
        args.device = pick_device()
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


def send_detections(model, result, args, headers, detection_count):
    if result.boxes is None:
        return
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


def infer_frames(model, args, headers, detection_count, frames, stop):
    # Producer thread: decode and inference run here while the consumer encodes and uploads.
    def put(item):
        while not stop.is_set():
            try:
                frames.put(item, timeout=0.5)
                return True
            except queue.Full:
                continue
        return False

    try:
        results = model.predict(
            source=str(args.source_path),
            conf=args.confidence,
            iou=args.iou,
            imgsz=args.image_size,
            vid_stride=args.vid_stride,
            device=args.device,
            stream=True,
            save=False,
            show=False,
            verbose=False,
        )
        for result in results:
            send_detections(model, result, args, headers, detection_count)
            if not put(result):
                return
        put(None)
    except BaseException as error:
        put(error)


def encode_frame(result, stream_width, jpeg_quality):
    import cv2

    annotated_frame = result.plot()
    height, width = annotated_frame.shape[:2]
    if stream_width > 0 and width > stream_width:
        annotated_frame = cv2.resize(
            annotated_frame,
            (stream_width, round(height * stream_width / width)),
            interpolation=cv2.INTER_AREA,
        )
    encoded, jpeg = cv2.imencode(
        ".jpg", annotated_frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]
    )
    if not encoded:
        raise RuntimeError("Failed to encode an annotated frame")
    return jpeg.tobytes()


def iter_annotated_frames(model, args, headers, detection_count):
    frames = queue.Queue(maxsize=FRAME_QUEUE_SIZE)
    stop = threading.Event()
    worker = threading.Thread(
        target=infer_frames,
        args=(model, args, headers, detection_count, frames, stop),
        daemon=True,
    )
    worker.start()

    try:
        while True:
            item = frames.get()
            if item is None:
                break
            if isinstance(item, BaseException):
                raise item

            jpeg_bytes = encode_frame(item, args.stream_width, args.jpeg_quality)
            part_header = (
                f"--{BOUNDARY}\r\n"
                "Content-Type: image/jpeg\r\n"
                f"Content-Length: {len(jpeg_bytes)}\r\n"
                "\r\n"
            ).encode("ascii")
            yield part_header + jpeg_bytes + b"\r\n"
    finally:
        stop.set()

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
