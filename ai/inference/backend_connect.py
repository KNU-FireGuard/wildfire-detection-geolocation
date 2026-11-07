import argparse
import math
import os
import queue
import sys
import threading
from pathlib import Path

import requests


AI_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = AI_DIR / "weights" / "yolo26s_final" / "weights" / "best.pt"
BOUNDARY = "frame"
FRAME_QUEUE_SIZE = 2


class CaptureSchedule:
    def __init__(self):
        self.last_saved = {}

    def due(self, class_name, timestamp):
        previous = self.last_saved.get(class_name)
        return previous is None or round(timestamp * 1000) - previous >= 5000

    def saved(self, class_name, timestamp):
        self.last_saved[class_name] = round(timestamp * 1000)

if str(AI_DIR.parent) not in sys.path:
    sys.path.insert(0, str(AI_DIR.parent))
from ai.inference.temporal_detection import FrameSampler, TemporalDetectionGate


def pick_device():
    import torch  # YOLO 없이 테스트할 수 있도록 실행 시점에 import

    if torch.cuda.is_available():
        return "cuda:0"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="FireGuard YOLO inference callback runner")
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--camera-id", type=int, required=True)
    parser.add_argument("--source-path", type=Path, required=True)
    parser.add_argument("--video-url", required=True, help="Annotated MJPEG upload URL")
    parser.add_argument("--result-url", required=True, help="Detection JSON API URL")
    parser.add_argument("--capture-url", help="If set, save confirmed JPEG captures instead of uploading MJPEG")
    parser.add_argument("--model-path", type=Path, default=DEFAULT_MODEL_PATH)
    parser.add_argument("--confidence", type=float, default=0.3, help="Minimum fire confidence")
    parser.add_argument("--smoke-confidence", type=float, default=0.5, help="Minimum smoke confidence")
    parser.add_argument("--iou", type=float, default=0.45)
    parser.add_argument("--image-size", type=int, default=640)
    parser.add_argument("--stream-width", type=int, default=960, help="Max width of streamed frames (0 = original)")
    parser.add_argument("--jpeg-quality", type=int, default=80)
    parser.add_argument("--device", default=None, help="cuda:0, mps, cpu (default: auto)")
    # 위치 추정용 (#60): 이름은 ai/config/cameras.json 보정 설정 조회, 위경도는 광선 출발점
    parser.add_argument("--camera-name")
    parser.add_argument("--camera-lat", type=float)
    parser.add_argument("--camera-lon", type=float)
    args = parser.parse_args(argv)

    if args.run_id <= 0 or args.camera_id <= 0:
        parser.error("--run-id and --camera-id must be positive integers")
    if not args.source_path.is_file():
        parser.error(f"Video file not found: {args.source_path}")
    if not args.model_path.is_file():
        parser.error(f"Model file not found: {args.model_path}")
    if not 0 <= args.confidence <= 1 or not 0 <= args.smoke_confidence <= 1 or not 0 <= args.iou <= 1:
        parser.error("--confidence, --smoke-confidence and --iou must be between 0 and 1")
    if args.image_size <= 0:
        parser.error("--image-size must be positive")
    if args.stream_width < 0:
        parser.error("--stream-width must be zero or positive")
    if not 1 <= args.jpeg_quality <= 100:
        parser.error("--jpeg-quality must be between 1 and 100")
    if (args.camera_lat is None) != (args.camera_lon is None):
        parser.error("--camera-lat and --camera-lon must be given together")
    if args.camera_lat is not None and not (-90 <= args.camera_lat <= 90 and -180 <= args.camera_lon <= 180):
        parser.error("--camera-lat/--camera-lon out of range")
    if args.device is None:
        args.device = pick_device()
    return args


def detection_payload(run_id, camera_id, class_name, confidence, coordinates, location=None):
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
        "location_estimation": location,
    }


def create_location_session(args):
    """실행 단위 위치 추정 세션, 만들 수 없으면 None (위치 없이 탐지만 전송)"""
    try:
        if str(AI_DIR.parent) not in sys.path:
            sys.path.insert(0, str(AI_DIR.parent))
        from ai.location_session import LocationSession

        return LocationSession(
            {"id": args.camera_id, "name": args.camera_name, "lat": args.camera_lat, "lon": args.camera_lon}
        )
    except Exception as exc:  # 위치 추정 준비 실패가 탐지·영상 전송을 막으면 안 됨
        print(f"Location session unavailable: {type(exc).__name__}: {exc}", flush=True)
        return None


def prepare_location(session, result):
    """첫 프레임에서 자세를 1회 결정, 실패 시 None을 돌려 이후 위치는 null"""
    if session is None:
        return None
    try:
        height, width = result.orig_img.shape[:2]
        status = session.prepare(frame=result.orig_img, frame_size=(width, height))
    except Exception as exc:
        print(f"Location prepare failed: {type(exc).__name__}: {exc}", flush=True)
        return None
    print(
        "Location status: ready={ready} mode={mode} reason={reason} warnings={warnings}".format(
            ready=status.get("ready"),
            mode=status.get("mode"),
            reason=status.get("reason"),
            warnings=status.get("warnings"),
        ),
        flush=True,
    )
    return status


def frame_detections(result, names, run_id, camera_id, session, fire_confidence=0.3, smoke_confidence=0.5,
                     gate=None, timestamp=None):
    """한 프레임의 fire·smoke box를 탐지 JSON 목록으로 변환, 세션이 있으면 위치 포함"""
    payloads = []
    for box in result.boxes if result.boxes is not None else []:
        class_name = str(names[int(box.cls.item())]).lower()
        if class_name not in {"fire", "smoke"}:
            continue
        confidence = float(box.conf.item())
        if confidence < (fire_confidence if class_name == "fire" else smoke_confidence):
            continue
        coordinates = box.xyxy[0].tolist()
        payloads.append(
            detection_payload(
                run_id=run_id,
                camera_id=camera_id,
                class_name=class_name,
                confidence=confidence,
                coordinates=coordinates,
            )
        )
    if gate is not None:
        candidates = [
            {"class": payload["detection"]["class"],
             "bbox": tuple(payload["detection"]["bbox"][key] for key in ("x1", "y1", "x2", "y2"))}
            for payload in payloads
        ]
        payloads = [payloads[index] for index in gate.update(timestamp, candidates)]
    if session is not None:
        for payload in payloads:
            bbox = payload["detection"]["bbox"]
            payload["location_estimation"] = session.locate([bbox[key] for key in ("x1", "y1", "x2", "y2")])
    return payloads


def send_detections(model, result, args, headers, detection_count, session=None, gate=None, timestamp=None,
                    capture_schedule=None):
    for payload in frame_detections(
        result, model.names, args.run_id, args.camera_id, session,
        fire_confidence=args.confidence, smoke_confidence=args.smoke_confidence,
        gate=gate, timestamp=timestamp,
    ):
        response = requests.post(
            args.result_url,
            headers=headers,
            json=payload,
            timeout=(5, 30),
        )
        response.raise_for_status()
        detection_count[0] += 1
        capture_url = getattr(args, 'capture_url', None)
        class_name = payload['detection']['class']
        if capture_url and capture_schedule is not None and capture_schedule.due(class_name, timestamp):
            try:
                jpeg = encode_frame(result, args.stream_width, args.jpeg_quality)
                capture_response = requests.post(
                    f"{capture_url}/{class_name}",
                    headers={**headers, 'Content-Type': 'image/jpeg', 'X-Video-Time-Ms': str(round(timestamp * 1000))},
                    data=jpeg, timeout=(5, 10),
                )
                capture_response.raise_for_status()
                capture_schedule.saved(class_name, timestamp)
            except Exception as exc:
                print(f"Capture save failed: {type(exc).__name__}: {exc}", flush=True)


def filter_result_boxes(result, names, fire_confidence, smoke_confidence):
    """영상 박스와 탐지 JSON에 동일한 클래스별 confidence 기준 적용."""
    if result.boxes is None:
        return
    boxes = result.boxes
    keep = boxes.conf > 1  # 클래스별 조건을 합칠 빈 마스크
    entries = names.items() if isinstance(names, dict) else enumerate(names)
    thresholds = {"fire": fire_confidence, "smoke": smoke_confidence}
    for class_id, name in entries:
        threshold = thresholds.get(str(name).lower())
        if threshold is not None:
            keep |= (boxes.cls == class_id) & (boxes.conf >= threshold)
    result.update(boxes=boxes.data[keep])


def sampled_video_frames(source_path, stop):
    """MP4의 영상 시각 기준 5fps 선택, 선택하지 않은 프레임은 YOLO에 전달하지 않음."""
    import cv2

    capture = cv2.VideoCapture(str(source_path))
    try:
        if not capture.isOpened():
            raise RuntimeError("Failed to open source video")
        fps = capture.get(cv2.CAP_PROP_FPS)
        if not math.isfinite(fps) or fps < 5:
            raise RuntimeError("5fps analysis requires source video FPS >= 5")
        sampler = FrameSampler()
        index = 0
        previous_timestamp = None
        while not stop.is_set():
            ok, frame = capture.read()
            if not ok:
                break
            timestamp = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
            # 일부 MP4 디코더는 POS_MSEC를 제공하지 않음: 명시된 원본 FPS로 복원
            if not math.isfinite(timestamp) or timestamp < 0 or (previous_timestamp is not None and timestamp <= previous_timestamp):
                timestamp = index / fps
            previous_timestamp = timestamp
            index += 1
            if sampler.accept(timestamp):
                yield timestamp, frame
    finally:
        capture.release()


def infer_frames(model, args, headers, detection_count, frames, stop, session=None):
    # Producer thread: decode and inference run here while the consumer encodes and uploads.
    def put(item):
        if frames is None:
            return True
        while not stop.is_set():
            try:
                frames.put(item, timeout=0.5)
                return True
            except queue.Full:
                continue
        return False

    try:
        import cv2

        gate = TemporalDetectionGate()
        capture_schedule = CaptureSchedule()
        prepared = False
        previous_scene = None
        previous_shape = None
        for timestamp, frame in sampled_video_frames(args.source_path, stop):
            # 큰 장면 전환·해상도 변경 시 이전 시점의 탐지 투표를 이어붙이지 않음
            scene = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (32, 18))
            scene_changed = previous_scene is not None and (
                frame.shape != previous_shape
                or cv2.absdiff(scene, previous_scene).mean() / 255 > 0.25
            )
            if scene_changed:
                gate.reset()
                # 고정 프리셋 자세를 다른 시점에 재사용하면 잘못된 위치가 나올 수 있음
                session = None
                print("Scene changed: reset detection window; location disabled for this run", flush=True)
            previous_scene, previous_shape = scene, frame.shape
            result = model.predict(
                source=frame,
                conf=min(args.confidence, args.smoke_confidence),
                iou=args.iou,
                imgsz=args.image_size,
                device=args.device,
                save=False,
                show=False,
                verbose=False,
            )[0]
            filter_result_boxes(result, model.names, args.confidence, args.smoke_confidence)
            if not prepared:
                # 위치 추정 자세는 첫 분석 프레임에서 1회 결정, 실패하면 이후 위치는 null
                prepared = True
                status = prepare_location(session, result)
                if status is None or not status.get("ready"):
                    session = None
            send_detections(model, result, args, headers, detection_count, session, gate, timestamp, capture_schedule)
            if not put(result):
                return
        put(None)
    except BaseException as error:
        if frames is None:
            raise
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


def iter_annotated_frames(model, args, headers, detection_count, session=None):
    frames = queue.Queue(maxsize=FRAME_QUEUE_SIZE)
    stop = threading.Event()
    worker = threading.Thread(
        target=infer_frames,
        args=(model, args, headers, detection_count, frames, stop, session),
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

    from ultralytics import YOLO  # YOLO 없이 테스트할 수 있도록 실행 시점에 import

    headers = {"X-AI-Token": token}
    model = YOLO(str(args.model_path))
    session = create_location_session(args)
    detection_count = [0]

    if args.capture_url:
        infer_frames(model, args, headers, detection_count, None, threading.Event(), session)
        print(f"Run ID: {args.run_id}; detections sent: {detection_count[0]}; capture analysis completed", flush=True)
        return

    response = requests.post(
        args.video_url,
        headers={
            **headers,
            "Content-Type": f"multipart/x-mixed-replace; boundary={BOUNDARY}",
        },
        data=iter_annotated_frames(model, args, headers, detection_count, session),
        timeout=(10, None),
    )
    response.raise_for_status()

    print(f"Run ID: {args.run_id}")
    print(f"Camera ID: {args.camera_id}")
    print(f"Annotated stream sent: {args.video_url}")
    print(f"Detections sent: {detection_count[0]}")


if __name__ == "__main__":
    main()
