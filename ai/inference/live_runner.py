"""HLS 수신 → 카메라별 5fps → 공유 YOLO → 16/20 확정 → 기존 탐지 API."""
from __future__ import annotations

import json
import math
import os
import signal
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
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


class FrameClock:
    """디코더 시각이 누락되어도 마지막 영상 시각에서 이어서 복원."""
    def __init__(self, fps):
        self.fps = fps
        self.previous = None
        self.last_source = None
        self.fallbacks = 0

    def resolve(self, timestamp):
        valid = math.isfinite(timestamp) and timestamp >= 0
        if valid and (timestamp > 0 or self.previous is None):
            if self.last_source is not None and timestamp < self.last_source - 1e-6:
                raise RuntimeError("stream_timestamp_reset")
            self.last_source = timestamp
            if self.previous is None or timestamp > self.previous:
                self.previous = timestamp
                return timestamp
        if not math.isfinite(self.fps) or self.fps < 5:
            raise RuntimeError("stream_timing_unavailable")
        self.previous = 0 if self.previous is None else self.previous + 1 / self.fps
        self.fallbacks += 1
        return self.previous


def receive(camera, buffer, stop):
    import cv2

    generation = 0
    sequence = 0
    delay = 2
    while not stop.is_set():
        capture = None
        clock = None
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
            clock = FrameClock(fps)
            origin = None
            while not stop.is_set():
                ok, frame = capture.read()
                if not ok:
                    raise RuntimeError("stream_read_failed")
                previous_fallbacks = clock.fallbacks
                timestamp = clock.resolve(capture.get(cv2.CAP_PROP_POS_MSEC) / 1000)
                if not previous_fallbacks and clock.fallbacks:
                    log(f"[live camera={camera['camera_id']}] timestamp fallback: continue from previous position at source FPS")
                if not sampler.accept(timestamp):
                    continue
                if origin is None:
                    origin = time.monotonic() - timestamp
                    log(f"[live camera={camera['camera_id']}] first_timestamp={timestamp:.3f} source_fps={fps:.2f}")
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
            if clock is not None and clock.fallbacks:
                log(f"[live camera={camera['camera_id']}] timestamp_fallbacks={clock.fallbacks}")
        if stop.wait(delay):
            break
        delay = min(delay * 2, 30)


def location_for(camera):
    """좌표가 있으면 기존 세션 사용, 고정 자세가 없으면 능선·DEM으로 자세 자동 추정."""
    if camera.get("latitude") is None or camera.get("longitude") is None:
        return None
    from ai.location_session import LocationSession

    # Test 카메라의 DB ID 설정과 우연히 매칭되지 않도록 이름으로만 선택
    return LocationSession({"id": None, "name": camera["name"],
                            "lat": camera["latitude"], "lon": camera["longitude"]},
                           allow_fixed_pose=camera.get("allow_fixed_pose", True))


class CameraAnalysis:
    def __init__(self, camera):
        self.camera = camera
        self.gate = TemporalDetectionGate()
        self.previous = None
        self.scene = None
        self.shape = None
        self.pose = PoseContext()
        self.context = AnalysisContext(pose=self.pose)
        self.stable_count = 0
        self.stable_since = None

    def reset(self, recalibrate=False):
        self.gate.reset()
        self.context.cancelled.set()
        enabled = self.context.location_enabled
        if recalibrate:
            self.pose.cancelled.set()
            self.pose = PoseContext(allow_fixed_pose=False)
            enabled = False
            self.scene = None
            self.shape = None
            self.previous = None
        self.context = AnalysisContext(location_enabled=enabled, pose=self.pose)
        self.stable_count = 0
        self.stable_since = None

    def process(self, result, names, packet):
        import cv2

        if time.monotonic() - packet.captured_at > 1:
            self.reset()
            return []
        if self.previous and packet.generation != self.previous.generation:
            self.reset(recalibrate=True)
        elif self.previous and (packet.sequence != self.previous.sequence + 1
                                or not 0 < packet.timestamp - self.previous.timestamp <= 0.4 + 1e-6):
            self.reset()
        self.previous = packet
        scene = cv2.resize(cv2.cvtColor(packet.frame, cv2.COLOR_BGR2GRAY), (32, 18))
        changed = self.scene is not None and (
            packet.frame.shape != self.shape or cv2.absdiff(scene, self.scene).mean() / 255 > 0.25
        )
        if changed:
            self.reset(recalibrate=True)
            self.previous = packet
        self.scene, self.shape = scene, packet.frame.shape
        if not self.context.location_enabled:
            self.stable_count += 1
            if self.stable_since is None:
                self.stable_since = packet.timestamp
            if self.stable_count >= 10 and packet.timestamp - self.stable_since >= 1.8 - 1e-6:
                self.context.location_enabled = True
        return frame_detections(result, names, self.camera["run_id"], self.camera["camera_id"], None,
                                gate=self.gate, timestamp=packet.timestamp)


@dataclass
class PoseContext:
    allow_fixed_pose: bool = True
    cancelled: threading.Event = field(default_factory=threading.Event)


@dataclass
class AnalysisContext:
    location_enabled: bool = True
    cancelled: threading.Event = field(default_factory=threading.Event)
    pose: PoseContext = field(default_factory=PoseContext)


@dataclass
class LocationTask:
    camera: dict
    packet: Packet
    context: AnalysisContext
    payload: dict | None = None

    def current(self):
        return not self.context.cancelled.is_set() and not self.context.pose.cancelled.is_set()

    def fresh(self):
        return self.current() and time.monotonic() - self.packet.captured_at <= 5


class TimingStats:
    def __init__(self):
        self.values = {}
        self.lock = threading.Lock()

    def record(self, stage, elapsed, camera_id=None):
        with self.lock:
            entry = self.values.setdefault((camera_id, stage), [0, 0, 0])
            entry[0] += 1
            entry[1] += elapsed * 1000
            entry[2] = max(entry[2], elapsed * 1000)

    def take(self, camera_id=None):
        with self.lock:
            keys = [key for key in self.values if key[0] == camera_id]
            values = {stage: self.values.pop((camera_id, stage)) for _, stage in keys}
        return {stage: {"count": count, "avg_ms": round(total / count, 1), "max_ms": round(maximum, 1)}
                for stage, (count, total, maximum) in values.items()}


@dataclass
class LocationState:
    pose: PoseContext
    session: object = None
    ready: bool = False
    terminal: bool = False
    retry_at: float = 0
    attempts: int = 0


class LocationWorker:
    """DEM 준비·위치 계산은 별도 스레드에서 처리, 대기는 카메라·클래스별 최신 표본만 유지."""
    def __init__(self, emit, session_factory=None, timings=None, retry_delay=30, max_retry_delay=300):
        self.emit = emit
        self.session_factory = session_factory or location_for
        self.timings = timings or TimingStats()
        self.pending = {}
        self.states = {}
        self.retry_delay = retry_delay
        self.max_retry_delay = max_retry_delay
        self.lock = threading.Lock()

    def _state(self, task):
        # 호출자가 lock을 유지, 자세 변경 전의 세션과 대기 결과를 이어받지 않음
        camera_id = task.camera["camera_id"]
        state = self.states.get(camera_id)
        if state is None or state.pose is not task.context.pose:
            state = LocationState(task.context.pose)
            self.states[camera_id] = state
            self.pending = {key: item for key, item in self.pending.items()
                            if item.camera["camera_id"] != camera_id or item.context.pose is task.context.pose}
        return state

    def observe(self, camera, packet, context):
        # 첫 분석 프레임부터 DEM을 준비해 첫 확정 탐지 시의 대기를 줄임
        task = LocationTask(camera, packet, context)
        if not context.location_enabled or not task.current():
            return
        with self.lock:
            if not task.current():
                return
            state = self._state(task)
            if not state.ready and not state.terminal and time.monotonic() >= state.retry_at:
                self.pending[(camera["camera_id"], "prepare")] = task

    def submit(self, task):
        if not task.fresh() or not task.context.location_enabled:
            return
        with self.lock:
            if not task.current():
                return
            state = self._state(task)
            if not state.terminal and (state.ready or time.monotonic() >= state.retry_at):
                self.pending[(task.camera["camera_id"], task.payload["detection"]["class"])] = task

    def run_once(self):
        with self.lock:
            if not self.pending:
                return False
            # 이미 전달된 탐지의 위치 보완을 다른 카메라의 사전 준비보다 우선
            key = next((key for key, task in self.pending.items() if task.payload is not None), next(iter(self.pending)))
            task = self.pending.pop(key)
        if not task.current() or not task.context.location_enabled or (task.payload is not None and not task.fresh()):
            return True
        camera_id = task.camera["camera_id"]
        with self.lock:
            if not task.current():
                return True
            state = self._state(task)
            if state.terminal or (not state.ready and time.monotonic() < state.retry_at):
                return True
        if not state.ready:
            started = time.monotonic()
            session = None
            terminal = False
            status = {"ready": False, "reason": "PREPARATION_FAILED"}
            try:
                session = self.session_factory({**task.camera, "allow_fixed_pose": state.pose.allow_fixed_pose})
                if session is None:
                    terminal = True
                    status = {"ready": False, "reason": "NO_CAMERA_COORDINATES"}
                else:
                    status = prepare_location(session, SimpleNamespace(orig_img=task.packet.frame)) or status
                    terminal = status.get("reason") == "NO_CAMERA_COORDINATES"
            except Exception as exc:
                log(f"[live camera={camera_id}] location preparation failed: {type(exc).__name__}")
            self.timings.record("location_prepare", time.monotonic() - started, camera_id)
            with self.lock:
                if state.pose.cancelled.is_set() or self.states.get(camera_id) is not state:
                    return True
                state.ready = bool(status.get("ready"))
                state.session = session if state.ready else None
                state.terminal = terminal
                if state.ready:
                    state.attempts = 0
                    state.retry_at = 0
                else:
                    state.attempts += 1
                    delay = min(self.retry_delay * 2 ** min(state.attempts - 1, 5), self.max_retry_delay)
                    state.retry_at = math.inf if terminal else time.monotonic() + delay
            warnings = ','.join(status.get("warnings") or []) or 'none'
            retry_in = 'none' if state.ready or terminal else f'{delay:.0f}'
            log(f"[live camera={camera_id}] location_ready={state.ready} mode={status.get('mode')} "
                f"reason={status.get('reason')} warnings={warnings} retry_in_s={retry_in}")
        session = state.session
        if session is None or task.payload is None or not task.fresh():
            return True
        started = time.monotonic()
        try:
            box = task.payload["detection"]["bbox"]
            location = session.locate([box[key] for key in ("x1", "y1", "x2", "y2")])
            if location is not None and task.fresh():
                self.emit(task, location)
        except Exception as exc:
            log(f"[live camera={camera_id}] location calculation failed: {type(exc).__name__}")
        finally:
            self.timings.record("location", time.monotonic() - started, camera_id)
        return True

    def run(self, stop):
        while not stop.is_set():
            if not self.run_once():
                stop.wait(0.02)


@dataclass
class Outbound:
    created: float
    url: str
    payload: dict
    task: LocationTask | None = None
    location: bool = False

    def fresh(self):
        return time.monotonic() - self.created <= 5 and (self.task is None or self.task.current())


class Callbacks:
    """HTTP 지연이 추론을 막지 않도록 최신 결과만 보관하는 제한된 전송함."""
    def __init__(self, config, token, timings=None):
        self.config = config
        self.headers = {"X-AI-Token": token}
        self.pending = {}
        self.heartbeats = {}
        self.lock = threading.Lock()
        self.locations = None
        self.timings = timings or TimingStats()

    def submit(self, camera, payloads, packet, context):
        now = time.monotonic()
        camera_id = camera["camera_id"]
        with self.lock:
            if now - self.heartbeats.get(camera_id, -math.inf) >= 10:
                self.pending[(camera_id, "heartbeat")] = Outbound(
                    now, self.config["heartbeat_url"], {"run_id": camera["run_id"], "camera_id": camera_id},
                )
                self.heartbeats[camera_id] = now
            for payload in payloads:
                task = LocationTask(camera, packet, context, payload)
                self.pending[(camera_id, payload["detection"]["class"], "detection")] = Outbound(
                    packet.captured_at, self.config["result_url"], payload, task,
                )

    def submit_location(self, task, location):
        if not task.fresh():
            return
        payload = {**task.payload, "location_estimation": location}
        key = (task.camera["camera_id"], payload["detection"]["class"], "location")
        with self.lock:
            self.pending[key] = Outbound(task.packet.captured_at, self.config["result_url"], payload, task, True)

    def flush_once(self, http, stop):
        import requests

        with self.lock:
            pending, self.pending = self.pending, {}
        for key, item in pending.items():
            if stop.is_set():
                return
            if not item.fresh():
                continue
            try:
                response = http.post(item.url, headers=self.headers, json=item.payload, timeout=(2, 3))
                response.raise_for_status()
                if item.task is not None:
                    stage = "location_delivery" if item.location else "detection_delivery"
                    self.timings.record(stage, time.monotonic() - item.created, key[0])
                    if not item.location and self.locations is not None:
                        # Backend가 탐지를 먼저 수락한 표본만 같은 이벤트의 위치 보완에 사용
                        self.locations.submit(item.task)
            except requests.RequestException as exc:
                log(f"[live camera={key[0]}] callback failed: {type(exc).__name__}")
                with self.lock:
                    self.pending.setdefault(key, item)

    def run(self, stop):
        import requests

        with requests.Session() as http:
            while not stop.wait(0.1):
                self.flush_once(http, stop)


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
    config = validate_config(json.load(sys.stdin.buffer))
    token = os.environ.get("AI_CALLBACK_TOKEN")
    if not token:
        raise RuntimeError("AI_CALLBACK_TOKEN is required")
    from ultralytics import YOLO

    model = YOLO(config.get("model_path") or str(DEFAULT_MODEL_PATH))
    device = pick_device()
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    timings = TimingStats()
    callbacks = Callbacks(config, token, timings)
    locations = LocationWorker(callbacks.submit_location, timings=timings)
    callbacks.locations = locations
    threads = [threading.Thread(target=callbacks.run, args=(stop,), daemon=True),
               threading.Thread(target=locations.run, args=(stop,), daemon=True)]
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
                    analyses[i].reset()
            if not fresh:
                stop.wait(0.01)
            else:
                for i, packet in fresh:
                    timings.record("queue", time.monotonic() - packet.captured_at, cameras[i]["camera_id"])
                started = time.monotonic()
                results = model.predict(source=[p.frame for _, p in fresh], conf=0.3, iou=0.45,
                                        imgsz=640, device=device, verbose=False, save=False)
                timings.record("batch_inference", time.monotonic() - started)
                for (i, packet), result in zip(fresh, results):
                    if time.monotonic() - packet.captured_at > 1:
                        analyses[i].reset()
                        continue
                    payloads = analyses[i].process(result, model.names, packet)
                    callbacks.submit(cameras[i], payloads, packet, analyses[i].context)
                    locations.observe(cameras[i], packet, analyses[i].context)
                    counts[i] += 1
            elapsed = time.monotonic() - report_at
            if elapsed >= 30:
                log(f"[live] timings={json.dumps(timings.take())}")
                for i, camera in enumerate(cameras):
                    camera_timings = json.dumps(timings.take(camera["camera_id"]))
                    log(f"[live camera={camera['camera_id']}] analysis_fps={counts[i] / elapsed:.1f} dropped={buffers[i].dropped} timings={camera_timings}")
                counts = [0] * len(cameras)
                report_at = time.monotonic()
    finally:
        stop.set()
        for thread in threads:
            thread.join(timeout=1)


if __name__ == "__main__":
    main()
