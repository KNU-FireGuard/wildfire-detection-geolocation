"""HLS 수신 → 카메라별 5fps → 공유 YOLO → 16/20 확정 → 기존 탐지 API."""
import json
import math
import os
import signal
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ai.inference.backend_connect import (
    DEFAULT_MODEL_PATH, frame_detections, pick_device, prepare_location,
)
from ai.inference.temporal_detection import FrameSampler, TemporalDetectionGate


def log(message):
    print(message, file=sys.stderr, flush=True)


@dataclass
class Packet:
    timestamp: float
    generation: int
    sequence: int
    captured_at: float
    frame: object


class LiveBuffer:
    def __init__(self):
        self.frames = deque(maxlen=3)
        self.lock = threading.Lock()
        self.dropped = 0

    def put(self, packet):
        with self.lock:
            if len(self.frames) == self.frames.maxlen:
                self.dropped += 1
            self.frames.append(packet)

    def take(self):
        with self.lock:
            return self.frames.popleft() if self.frames else None


def receive(camera, buffer, stop):
    import cv2

    generation = 0
    sequence = 0
    delay = 2
    while not stop.is_set():
        capture = None
        generation += 1
        try:
            capture = cv2.VideoCapture(camera["source_url"], cv2.CAP_FFMPEG, [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 15000,
                cv2.CAP_PROP_READ_TIMEOUT_MSEC, 10000,
            ])
            if not capture.isOpened():
                raise RuntimeError("stream_open_failed")
            fps = capture.get(cv2.CAP_PROP_FPS)
            sampler = FrameSampler()
            index = 0
            previous = None
            origin = None
            while not stop.is_set():
                ok, frame = capture.read()
                if not ok:
                    raise RuntimeError("stream_read_failed")
                timestamp = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
                if not math.isfinite(timestamp) or timestamp < 0 or (previous is not None and timestamp <= previous):
                    if not math.isfinite(fps) or fps < 5:
                        raise RuntimeError("stream_timing_unavailable")
                    timestamp = index / fps
                index += 1
                previous = timestamp
                if not sampler.accept(timestamp):
                    continue
                if origin is None:
                    origin = time.monotonic() - timestamp
                due = origin + timestamp
                # HLS가 한꺼번에 디코딩돼도 영상 시간에 맞춰 전달, 지연 누적 시 live edge로 재연결
                if time.monotonic() - due > 2:
                    raise RuntimeError("stream_behind_live_edge")
                if stop.wait(max(0, due - time.monotonic())):
                    break
                buffer.put(Packet(timestamp, generation, sequence, time.monotonic(), frame))
                sequence += 1
                delay = 2
        except Exception as exc:
            # 스트림 URL·인증 파라미터를 로그에 출력하지 않음
            reason = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
            log(f"[live camera={camera['camera_id']}] reconnect: {reason}")
        finally:
            if capture is not None:
                capture.release()
        if stop.wait(delay):
            break
        delay = min(delay * 2, 30)


def location_for(camera):
    """실시간은 이름이 일치하는 고정 카메라 보정값만 사용, 무보정 역산은 시도하지 않음."""
    try:
        from ai.camera_config import find_camera_config, load_camera_configs
        from ai.location_session import LocationSession

        config = find_camera_config(load_camera_configs(), name=camera.get("name"))
        if not config or not config.get("fixed_pose"):
            return None
        if camera.get("latitude") is None or camera.get("longitude") is None:
            return None
        # Test 카메라의 DB ID 설정과 우연히 매칭되지 않도록 이름으로만 선택
        return LocationSession({"id": None, "name": camera["name"],
                                "lat": camera["latitude"], "lon": camera["longitude"]})
    except Exception as exc:
        log(f"[live camera={camera['camera_id']}] location unavailable: {type(exc).__name__}")
        return None


class CameraAnalysis:
    def __init__(self, camera):
        self.camera = camera
        self.gate = TemporalDetectionGate()
        self.previous = None
        self.scene = None
        self.shape = None
        self.location_checked = False
        self.location = None

    def process(self, result, names, packet):
        import cv2

        if time.monotonic() - packet.captured_at > 1:
            self.gate.reset()
            return []
        if self.previous and (packet.generation != self.previous.generation
                              or packet.sequence != self.previous.sequence + 1):
            self.gate.reset()
        self.previous = packet
        scene = cv2.resize(cv2.cvtColor(packet.frame, cv2.COLOR_BGR2GRAY), (32, 18))
        changed = self.scene is not None and (
            packet.frame.shape != self.shape or cv2.absdiff(scene, self.scene).mean() / 255 > 0.25
        )
        if changed:
            self.gate.reset()
            self.location = None
            self.location_checked = True  # 시점 변경 뒤 기존 고정 자세를 재사용하지 않음
        self.scene, self.shape = scene, packet.frame.shape
        payloads = frame_detections(result, names, self.camera["run_id"], self.camera["camera_id"], None,
                                    gate=self.gate, timestamp=packet.timestamp)
        if payloads and not self.location_checked:
            self.location_checked = True
            self.location = location_for(self.camera)
            status = prepare_location(self.location, result)
            if not status or not status.get("ready"):
                self.location = None
        if self.location is not None:
            for payload in payloads:
                box = payload["detection"]["bbox"]
                payload["location_estimation"] = self.location.locate([box[key] for key in ("x1", "y1", "x2", "y2")])
        return payloads


class Callbacks:
    """HTTP 지연이 추론을 막지 않도록 최신 결과만 보관하는 제한된 전송함."""
    def __init__(self, config, token):
        self.config = config
        self.headers = {"X-AI-Token": token}
        self.pending = {}
        self.heartbeats = {}
        self.lock = threading.Lock()

    def submit(self, camera, payloads):
        now = time.monotonic()
        camera_id = camera["camera_id"]
        with self.lock:
            if now - self.heartbeats.get(camera_id, -math.inf) >= 10:
                self.pending[(camera_id, "heartbeat")] = (
                    now, self.config["heartbeat_url"], {"run_id": camera["run_id"], "camera_id": camera_id},
                )
                self.heartbeats[camera_id] = now
            for payload in payloads:
                self.pending[(camera_id, payload["detection"]["class"])] = (now, self.config["result_url"], payload)

    def run(self, stop):
        import requests

        with requests.Session() as http:
            while not stop.wait(0.1):
                with self.lock:
                    pending, self.pending = self.pending, {}
                for key, (created, url, payload) in pending.items():
                    if stop.is_set():
                        return
                    if time.monotonic() - created > 5:
                        continue
                    try:
                        response = http.post(url, headers=self.headers, json=payload, timeout=(2, 3))
                        response.raise_for_status()
                    except requests.RequestException as exc:
                        log(f"[live camera={key[0]}] callback failed: {type(exc).__name__}")
                        # 최신 결과가 있으면 우선 사용, 오래된 결과는 5초 뒤 폐기
                        with self.lock:
                            self.pending.setdefault(key, (created, url, payload))


def validate_config(config):
    for key in ("result_url", "heartbeat_url"):
        if urlparse(config.get(key, "")).scheme not in {"http", "https"}:
            raise ValueError(f"Invalid {key}")
    cameras = config.get("cameras", [])
    if not cameras or len(cameras) > 16:
        raise ValueError("Expected 1..16 cameras")
    seen = set()
    for camera in cameras:
        for key in ("camera_id", "run_id"):
            if type(camera.get(key)) is not int or camera[key] <= 0:
                raise ValueError(f"Invalid {key}")
        if camera["camera_id"] in seen or urlparse(camera.get("source_url", "")).scheme not in {"http", "https"}:
            raise ValueError("Invalid or duplicate camera")
        seen.add(camera["camera_id"])
    return config


def main():
    config = validate_config(json.load(sys.stdin))
    token = os.environ.get("AI_CALLBACK_TOKEN")
    if not token:
        raise RuntimeError("AI_CALLBACK_TOKEN is required")
    from ultralytics import YOLO

    model = YOLO(config.get("model_path") or str(DEFAULT_MODEL_PATH))
    device = pick_device()
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    callbacks = Callbacks(config, token)
    threads = [threading.Thread(target=callbacks.run, args=(stop,), daemon=True)]
    cameras = config["cameras"]
    buffers = [LiveBuffer() for _ in cameras]
    analyses = [CameraAnalysis(camera) for camera in cameras]
    for camera, buffer in zip(cameras, buffers):
        threads.append(threading.Thread(target=receive, args=(camera, buffer, stop), daemon=True))
    for thread in threads:
        thread.start()
    counts = [0] * len(cameras)
    report_at = time.monotonic()
    log(f"[live] started {len(cameras)} cameras device={device}; target=5fps; gate=16/20")
    try:
        while not stop.is_set():
            batch = [(i, buffer.take()) for i, buffer in enumerate(buffers)]
            batch = [(i, p) for i, p in batch if p is not None]
            fresh = []
            for i, p in batch:
                if time.monotonic() - p.captured_at <= 1:
                    fresh.append((i, p))
                else:
                    analyses[i].gate.reset()
            if not fresh:
                stop.wait(0.01)
                continue
            results = model.predict(source=[p.frame for _, p in fresh], conf=0.3, iou=0.45,
                                    imgsz=640, device=device, verbose=False, save=False)
            for (i, packet), result in zip(fresh, results):
                if time.monotonic() - packet.captured_at > 1:
                    analyses[i].gate.reset()
                    continue
                payloads = analyses[i].process(result, model.names, packet)
                callbacks.submit(cameras[i], payloads)
                counts[i] += 1
            elapsed = time.monotonic() - report_at
            if elapsed >= 30:
                for i, camera in enumerate(cameras):
                    log(f"[live camera={camera['camera_id']}] analysis_fps={counts[i] / elapsed:.1f} dropped={buffers[i].dropped}")
                counts = [0] * len(cameras)
                report_at = time.monotonic()
    finally:
        stop.set()
        for thread in threads:
            thread.join(timeout=1)


if __name__ == "__main__":
    main()
