import io
import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np
import requests

from ai.inference import live_runner
from ai.test_backend_connect import _Box, _Result, NAMES


CAMERA = {"camera_id": 1, "run_id": 2, "name": "review"}
FRAME = np.zeros((32, 32, 3), dtype=np.uint8)


def packet(sequence=19, captured_at=None):
    return live_runner.Packet(sequence / 5, 1, sequence,
                              live_runner.time.monotonic() if captured_at is None else captured_at, FRAME)


def confirmed_analysis(camera=CAMERA):
    analysis = live_runner.CameraAnalysis(camera)
    for index in range(19):
        analysis.gate.update(index / 5, [{"class": "fire", "bbox": (1, 1, 20, 20)}])
    return analysis


def result():
    value = _Result([_Box(0, .7, (1, 1, 20, 20))], shape=FRAME.shape)
    value.orig_img = FRAME
    return value


class Session:
    def __init__(self, prepare=None):
        self.on_prepare = prepare
        self.preparations = 0
        self.boxes = []

    def prepare(self, **kwargs):
        self.preparations += 1
        if self.on_prepare:
            self.on_prepare()
        return {"ready": True, "mode": "config_fixed_pose"}

    def locate(self, box):
        self.boxes.append(box)
        return {"latitude": 36.4, "longitude": 128.6, "error_range_m": 100}


class Http:
    def __init__(self):
        self.posts = []
        self.fail_detection = False

    def post(self, url, **kwargs):
        payload = kwargs["json"]
        if self.fail_detection and "detection" in payload:
            raise requests.ConnectionError("mock connection failure")
        self.posts.append(payload)
        return SimpleNamespace(raise_for_status=lambda: None)


def callbacks():
    return live_runner.Callbacks({"result_url": "http://example.test/detections",
                                  "heartbeat_url": "http://example.test/heartbeat"}, "dummy")


class LiveConfigEncodingTests(unittest.TestCase):
    def test_utf8_camera_names_survive_windows_and_utf8_stdin(self):
        names = ["청성", "경북의성", "단촌4터널"]
        config = {
            "result_url": "http://127.0.0.1:3000/api/detections",
            "heartbeat_url": "http://127.0.0.1:3000/api/live-monitor/heartbeat",
            "cameras": [
                {"camera_id": index, "run_id": index,
                 "source_url": "http://example.test/camera.m3u8", "name": name}
                for index, name in enumerate(names, start=1)
            ],
        }
        body = json.dumps(config, ensure_ascii=False).encode("utf-8")
        for encoding in ("cp949", "utf-8"):
            with self.subTest(encoding=encoding):
                with io.TextIOWrapper(io.BytesIO(body), encoding=encoding,
                                      errors="surrogateescape") as stdin:
                    with patch.object(live_runner.sys, "stdin", stdin), \
                         patch.dict(live_runner.os.environ, {}, clear=True), \
                         patch.object(live_runner, "validate_config",
                                      wraps=live_runner.validate_config) as validate:
                        # 모델·영상·네트워크 실행 전에 설정만 읽고 중단
                        with self.assertRaisesRegex(RuntimeError, "AI_CALLBACK_TOKEN is required"):
                            live_runner.main()
                    received = validate.call_args.args[0]
                    self.assertEqual([camera["name"] for camera in received["cameras"]], names)


class StreamClockTests(unittest.TestCase):
    def test_receiver_keeps_sampling_after_nonzero_first_timestamp_and_missing_positions(self):
        import cv2

        buffer = live_runner.LiveBuffer()
        clock = [1000.0]

        class Capture:
            index = 0

            def isOpened(self):
                return True

            def read(self):
                self.index += 1
                if self.index > 7:
                    raise AssertionError("receiver did not sample two frames")
                return True, FRAME

            def get(self, key):
                return 30 if key == cv2.CAP_PROP_FPS else 100_000 if self.index == 1 else 0

            def release(self):
                pass

        class Stop:
            def is_set(self):
                return len(buffer.frames) >= 2

            def wait(self, timeout):
                clock[0] += timeout
                return self.is_set()

        with patch.object(cv2, "VideoCapture", return_value=Capture()), \
             patch.object(live_runner.time, "monotonic", side_effect=lambda: clock[0]), \
             patch.object(live_runner, "log") as log:
            live_runner.receive({**CAMERA, "source_url": "http://example.test/stream.m3u8"}, buffer, Stop())
        self.assertEqual(len(buffer.frames), 2)
        self.assertAlmostEqual(buffer.frames[1].timestamp, 100.2)
        self.assertFalse(any("reconnect:" in call.args[0] for call in log.call_args_list))

    def test_missing_and_repeated_timestamps_keep_nonzero_origin(self):
        clock = live_runner.FrameClock(30)
        observed = [clock.resolve(value) for value in (100, 0, float("nan"), 100.1, 100.1)]
        for actual, expected in zip(observed, (100, 100 + 1/30, 100 + 2/30, 100.1, 100.1 + 1/30)):
            self.assertAlmostEqual(actual, expected)

    def test_true_source_timestamp_reversal_requests_reconnect(self):
        clock = live_runner.FrameClock(30)
        clock.resolve(100)
        with self.assertRaisesRegex(RuntimeError, "stream_timestamp_reset"):
            clock.resolve(50)

    def test_unavailable_timing_requires_usable_fps(self):
        clock = live_runner.FrameClock(float("nan"))
        self.assertEqual(clock.resolve(0), 0)
        with self.assertRaisesRegex(RuntimeError, "stream_timing_unavailable"):
            clock.resolve(0)


class LiveLocationTests(unittest.TestCase):
    def test_expired_http_detection_does_not_start_location_work(self):
        clock = [100.0]
        cb = callbacks()
        worker = live_runner.LocationWorker(cb.submit_location, session_factory=lambda camera: Session())
        cb.locations = worker
        http = Http()
        with patch.object(live_runner.time, "monotonic", side_effect=lambda: clock[0]):
            analysis, frame = confirmed_analysis(), packet(captured_at=100)
            cb.submit(CAMERA, analysis.process(result(), NAMES, frame), frame, analysis.context)
            clock[0] = 105.01
            cb.flush_once(http, threading.Event())
        self.assertEqual(http.posts, [])
        self.assertFalse(worker.run_once())

    def test_location_failure_does_not_stop_another_camera(self):
        emitted = []

        class BrokenSession(Session):
            def locate(self, box):
                raise RuntimeError("mock location failure")

        worker = live_runner.LocationWorker(lambda task, location: emitted.append(task.camera["camera_id"]),
                                           session_factory=lambda camera: BrokenSession() if camera["camera_id"] == 1 else Session())
        for camera in (CAMERA, {**CAMERA, "camera_id": 3, "run_id": 4}):
            analysis, frame = confirmed_analysis(camera), packet()
            payload = analysis.process(result(), NAMES, frame)[0]
            worker.submit(live_runner.LocationTask(camera, frame, analysis.context, payload))
        worker.run_once()
        worker.run_once()
        self.assertEqual(emitted, [3])

    def test_confirmation_does_not_prepare_or_calculate_location(self):
        analysis = confirmed_analysis()
        with patch.object(live_runner, "location_for", side_effect=AssertionError("location blocked inference")):
            payloads = analysis.process(result(), NAMES, packet())
        self.assertEqual(len(payloads), 1)
        self.assertIsNone(payloads[0]["location_estimation"])

    def test_slow_background_preparation_does_not_block_detection_for_either_camera(self):
        entered, release, located = threading.Event(), threading.Event(), threading.Event()

        def slow_prepare():
            entered.set()
            if not release.wait(3):
                raise AssertionError("test did not release location preparation")

        cb = callbacks()
        session = Session(slow_prepare)

        def emit(task, location):
            cb.submit_location(task, location)
            located.set()

        worker = live_runner.LocationWorker(emit, session_factory=lambda camera: session)
        cb.locations = worker
        analysis = confirmed_analysis()
        frame = packet()
        worker.observe(CAMERA, frame, analysis.context)
        stop = threading.Event()
        thread = threading.Thread(target=worker.run, args=(stop,), daemon=True)
        thread.start()
        try:
            self.assertTrue(entered.wait(2))
            http = Http()
            cb.submit(CAMERA, analysis.process(result(), NAMES, frame), frame, analysis.context)
            cb.flush_once(http, stop)
            other = {**CAMERA, "camera_id": 3, "run_id": 4}
            other_analysis = confirmed_analysis(other)
            other_frame = packet()
            cb.submit(other, other_analysis.process(result(), NAMES, other_frame), other_frame, other_analysis.context)
            cb.flush_once(http, stop)
            detections = [item for item in http.posts if "detection" in item]
            self.assertEqual([item["camera_id"] for item in detections], [1, 3])
            self.assertTrue(all(item["location_estimation"] is None for item in detections))
            release.set()
            self.assertTrue(located.wait(2))
            cb.flush_once(http, stop)
            self.assertTrue(any(item.get("location_estimation") for item in http.posts))
        finally:
            release.set()
            stop.set()
            thread.join(2)
        self.assertFalse(thread.is_alive())

    def test_location_only_follows_successful_detection_delivery(self):
        cb, session, stop = callbacks(), Session(), threading.Event()
        worker = live_runner.LocationWorker(cb.submit_location, session_factory=lambda camera: session)
        cb.locations = worker
        analysis, frame = confirmed_analysis(), packet()
        cb.submit(CAMERA, analysis.process(result(), NAMES, frame), frame, analysis.context)
        http = Http()
        http.fail_detection = True
        cb.flush_once(http, stop)
        self.assertFalse(worker.run_once())
        http.fail_detection = False
        cb.flush_once(http, stop)
        self.assertTrue(worker.run_once())
        cb.flush_once(http, stop)
        detections = [item for item in http.posts if "detection" in item]
        self.assertEqual(len(detections), 2)
        self.assertIsNone(detections[0]["location_estimation"])
        self.assertIsNotNone(detections[1]["location_estimation"])
        self.assertEqual(detections[0]["run_id"], detections[1]["run_id"])

    def test_scene_change_cancels_location_already_queued_for_http(self):
        cb, stop = callbacks(), threading.Event()
        worker = live_runner.LocationWorker(cb.submit_location, session_factory=lambda camera: Session())
        cb.locations = worker
        analysis, frame = confirmed_analysis(), packet()
        cb.submit(CAMERA, analysis.process(result(), NAMES, frame), frame, analysis.context)
        http = Http()
        cb.flush_once(http, stop)
        worker.run_once()
        next_frame = packet(20)
        next_frame.frame = np.full_like(FRAME, 255)
        analysis.process(result(), NAMES, next_frame)
        cb.flush_once(http, stop)
        self.assertFalse(any(item.get("location_estimation") for item in http.posts))

    def test_reconnect_cancels_pending_location_calculation(self):
        cb = callbacks()
        factory_calls = []
        worker = live_runner.LocationWorker(cb.submit_location,
                                           session_factory=lambda camera: factory_calls.append(camera) or Session())
        cb.locations = worker
        analysis, frame = confirmed_analysis(), packet()
        cb.submit(CAMERA, analysis.process(result(), NAMES, frame), frame, analysis.context)
        cb.flush_once(Http(), threading.Event())
        reconnected = packet(20)
        reconnected.generation = 2
        analysis.process(result(), NAMES, reconnected)
        worker.run_once()
        self.assertEqual(factory_calls, [])

    def test_old_location_is_not_made_fresh_after_slow_preparation(self):
        clock = [100.0]
        cb = callbacks()
        session = Session(lambda: clock.__setitem__(0, 110.0))
        worker = live_runner.LocationWorker(cb.submit_location, session_factory=lambda camera: session)
        cb.locations = worker
        analysis = confirmed_analysis()
        http, stop = Http(), threading.Event()
        with patch.object(live_runner.time, "monotonic", side_effect=lambda: clock[0]):
            frame = packet(captured_at=100)
            cb.submit(CAMERA, analysis.process(result(), NAMES, frame), frame, analysis.context)
            cb.flush_once(http, stop)
            worker.run_once()
            cb.flush_once(http, stop)
            self.assertEqual(session.boxes, [])
            fresh_frame = packet(20, captured_at=110)
            cb.submit(CAMERA, analysis.process(result(), NAMES, fresh_frame), fresh_frame, analysis.context)
            cb.flush_once(http, stop)
            worker.run_once()
            cb.flush_once(http, stop)
        self.assertEqual(session.preparations, 1)
        self.assertTrue(any(item.get("location_estimation") for item in http.posts))

    def test_waiting_location_jobs_use_latest_sample_of_each_class(self):
        emitted, session = [], Session()
        worker = live_runner.LocationWorker(lambda task, location: emitted.append(task),
                                           session_factory=lambda camera: session)
        analysis = confirmed_analysis()
        for sequence in range(19, 39):
            frame = packet(sequence)
            payload = analysis.process(result(), NAMES, frame)[0]
            worker.submit(live_runner.LocationTask(CAMERA, frame, analysis.context, payload))
        self.assertTrue(worker.run_once())
        self.assertFalse(worker.run_once())
        self.assertEqual([task.packet.sequence for task in emitted], [38])


class TimingTests(unittest.TestCase):
    def test_stage_logs_keep_count_average_and_maximum_without_mixing_cameras(self):
        timings = live_runner.TimingStats()
        timings.record("batch_inference", .1)
        timings.record("batch_inference", .3)
        timings.record("location_prepare", 2, 1)
        self.assertEqual(timings.take(), {"batch_inference": {"count": 2, "avg_ms": 200, "max_ms": 300}})
        self.assertEqual(timings.take(1), {"location_prepare": {"count": 1, "avg_ms": 2000, "max_ms": 2000}})
        self.assertEqual(timings.take(), {})


class AutomaticLiveLocationTests(unittest.TestCase):
    def test_unconfigured_live_camera_runs_existing_blind_session_and_sends_position(self):
        from ai.location_session import LocationSession

        camera = {**CAMERA, "name": "unconfigured live camera", "latitude": 36.4, "longitude": 128.6}
        location = {"latitude": 36.401, "longitude": 128.601, "error_range_m": 100}
        provider = SimpleNamespace(estimate_blind_ptz=Mock(return_value={
            "calibrated": True, "pan": 90.0, "tilt": -2.0, "roll": 0.0,
            "rms_deg": .2, "uniqueness_ratio": 2.0,
        }))
        estimator = SimpleNamespace(
            camera_configs=[],
            skyline_extractor=SimpleNamespace(extract=lambda **kwargs: {"is_valid": True, "ridge_pts": np.zeros((20, 2))}),
            _get_provider=lambda *args: provider,
            estimate_location=lambda *args, **kwargs: {"location_estimation": location},
        )
        sessions = []

        def create_session(camera, **kwargs):
            session = LocationSession(camera, estimator=estimator, **kwargs)
            sessions.append(session)
            return session

        cb, http, stop = callbacks(), Http(), threading.Event()
        worker = live_runner.LocationWorker(cb.submit_location)
        cb.locations = worker
        analysis, frame = confirmed_analysis(camera), packet()
        with patch('ai.location_session.LocationSession', side_effect=create_session):
            worker.observe(camera, frame, analysis.context)
            worker.run_once()
            cb.submit(camera, analysis.process(result(), NAMES, frame), frame, analysis.context)
            cb.flush_once(http, stop)
            worker.run_once()
            cb.flush_once(http, stop)
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0].status["mode"], "blind_360_once")
        self.assertEqual(sessions[0].status["fov_h_deg"], 60)
        self.assertIn("FOV_DEFAULT_USED", sessions[0].status["warnings"])
        self.assertEqual(provider.estimate_blind_ptz.call_count, 3)
        detections = [item for item in http.posts if "detection" in item]
        self.assertIsNone(detections[0]["location_estimation"])
        self.assertEqual(detections[1]["location_estimation"], location)

    def test_camera_without_coordinates_skips_location_without_importing_estimator(self):
        with patch('ai.location_session.LocationSession') as create:
            self.assertIsNone(live_runner.location_for({**CAMERA, "latitude": None, "longitude": None}))
        create.assert_not_called()

    def test_preparation_failure_retries_with_backoff_then_recovers(self):
        clock = [100.0]

        class RecoveringSession(Session):
            def prepare(self, **kwargs):
                self.preparations += 1
                ready = self.preparations >= 3
                return {"ready": ready, "reason": None if ready else "DEM_UNAVAILABLE"}

        session, calls = RecoveringSession(), []
        worker = live_runner.LocationWorker(lambda *args: None,
                                           session_factory=lambda camera: calls.append(camera) or session)
        context = confirmed_analysis().context
        with patch.object(live_runner.time, "monotonic", side_effect=lambda: clock[0]):
            for timestamp, expected_calls in ((100, 1), (129, 1), (130, 2), (189, 2), (190, 3), (300, 3)):
                clock[0] = timestamp
                worker.observe(CAMERA, packet(captured_at=timestamp), context)
                worker.run_once()
                self.assertEqual(len(calls), expected_calls)

    def test_repeated_failures_cap_retry_delay_at_five_minutes(self):
        clock, calls = [100.0], []

        class Offline(Session):
            def prepare(self, **kwargs):
                return {"ready": False, "reason": "DEM_UNAVAILABLE"}

        worker = live_runner.LocationWorker(lambda *args: None,
                                           session_factory=lambda camera: calls.append(camera) or Offline())
        context = confirmed_analysis().context
        with patch.object(live_runner.time, "monotonic", side_effect=lambda: clock[0]):
            for timestamp, expected in ((100, 1), (130, 2), (190, 3), (310, 4), (550, 5),
                                        (849, 5), (850, 6), (1149, 6), (1150, 7)):
                clock[0] = timestamp
                worker.observe(CAMERA, packet(captured_at=timestamp), context)
                worker.run_once()
                self.assertEqual(len(calls), expected)

    def test_missing_coordinates_are_not_retried(self):
        clock, calls = [100.0], []
        camera = {**CAMERA, "latitude": None, "longitude": None}
        worker = live_runner.LocationWorker(lambda *args: None,
                                           session_factory=lambda camera: calls.append(camera) or None)
        context = confirmed_analysis().context
        with patch.object(live_runner.time, "monotonic", side_effect=lambda: clock[0]):
            for timestamp in (100, 130, 500):
                clock[0] = timestamp
                worker.observe(camera, packet(captured_at=timestamp), context)
                worker.run_once()
        self.assertEqual(len(calls), 1)

    def test_ridge_quality_failure_keeps_fire_detection_and_does_not_emit_position(self):
        class NoRidge(Session):
            def prepare(self, **kwargs):
                return {"ready": False, "reason": "RIDGE_NOT_DETECTED"}

        cb, http, stop = callbacks(), Http(), threading.Event()
        worker = live_runner.LocationWorker(cb.submit_location, session_factory=lambda camera: NoRidge())
        cb.locations = worker
        analysis, frame = confirmed_analysis(), packet()
        cb.submit(CAMERA, analysis.process(result(), NAMES, frame), frame, analysis.context)
        cb.flush_once(http, stop)
        worker.run_once()
        cb.flush_once(http, stop)
        detections = [item for item in http.posts if "detection" in item]
        self.assertEqual(len(detections), 1)
        self.assertIsNone(detections[0]["location_estimation"])

    def test_changed_view_waits_for_stability_then_prepares_a_new_pose(self):
        calls = []
        worker = live_runner.LocationWorker(lambda *args: None,
                                           session_factory=lambda camera: calls.append(camera) or Session())
        analysis = confirmed_analysis()
        first = packet()
        analysis.process(result(), NAMES, first)
        worker.observe(CAMERA, first, analysis.context)
        worker.run_once()
        old_context = analysis.context
        for sequence in range(20, 30):
            frame = packet(sequence)
            frame.frame = np.full_like(FRAME, 255)
            analysis.process(result(), NAMES, frame)
            worker.observe(CAMERA, frame, analysis.context)
            worker.run_once()
            self.assertEqual(len(calls), 2 if sequence == 29 else 1)
        self.assertTrue(old_context.cancelled.is_set())
        self.assertTrue(analysis.context.location_enabled)
        self.assertFalse(calls[-1]["allow_fixed_pose"])

    def test_reconnect_reprepares_even_when_the_image_looks_unchanged(self):
        calls = []
        worker = live_runner.LocationWorker(lambda *args: None,
                                           session_factory=lambda camera: calls.append(camera) or Session())
        analysis = confirmed_analysis()
        first = packet()
        analysis.process(result(), NAMES, first)
        worker.observe(CAMERA, first, analysis.context)
        worker.run_once()
        for sequence in range(20, 30):
            frame = packet(sequence)
            frame.generation = 2
            analysis.process(result(), NAMES, frame)
            worker.observe(CAMERA, frame, analysis.context)
            worker.run_once()
        self.assertEqual(len(calls), 2)
        self.assertFalse(calls[-1]["allow_fixed_pose"])

    def test_reconnect_is_detected_after_stale_frames_reset_the_votes(self):
        calls = []
        worker = live_runner.LocationWorker(lambda *args: None,
                                           session_factory=lambda camera: calls.append(camera) or Session())
        analysis = confirmed_analysis()
        first = packet()
        analysis.process(result(), NAMES, first)
        worker.observe(CAMERA, first, analysis.context)
        worker.run_once()
        analysis.reset()  # Main loop discarded an expired frame before reconnect.
        for sequence in range(20, 30):
            frame = packet(sequence)
            frame.generation = 2
            analysis.process(result(), NAMES, frame)
            worker.observe(CAMERA, frame, analysis.context)
            worker.run_once()
        self.assertEqual(len(calls), 2)

    def test_frame_drop_resets_votes_but_reuses_unchanged_camera_pose(self):
        calls = []
        worker = live_runner.LocationWorker(lambda *args: None,
                                           session_factory=lambda camera: calls.append(camera) or Session())
        analysis = confirmed_analysis()
        for sequence in (19, 21):
            frame = packet(sequence)
            analysis.process(result(), NAMES, frame)
            worker.observe(CAMERA, frame, analysis.context)
            worker.run_once()
        self.assertEqual(len(calls), 1)

    def test_scene_change_during_preparation_does_not_cache_the_old_pose(self):
        calls = []
        analysis = confirmed_analysis()

        def switch_scene():
            for sequence in range(20, 30):
                frame = packet(sequence)
                frame.frame = np.full_like(FRAME, 255)
                analysis.process(result(), NAMES, frame)
                worker.observe(CAMERA, frame, analysis.context)

        def create(camera):
            calls.append(camera)
            return Session(switch_scene if len(calls) == 1 else None)

        worker = live_runner.LocationWorker(lambda *args: None, session_factory=create)
        first = packet()
        analysis.process(result(), NAMES, first)
        worker.observe(CAMERA, first, analysis.context)
        worker.run_once()
        worker.run_once()
        self.assertEqual(len(calls), 2)
        self.assertFalse(calls[-1]["allow_fixed_pose"])

    def test_frame_drop_during_preparation_keeps_completed_pose_but_not_old_location(self):
        calls = []
        analysis = confirmed_analysis()

        def drop_frame():
            frame = packet(21)
            analysis.process(result(), NAMES, frame)
            worker.observe(CAMERA, frame, analysis.context)

        def create(camera):
            calls.append(camera)
            return Session(drop_frame if len(calls) == 1 else None)

        worker = live_runner.LocationWorker(lambda *args: None, session_factory=create)
        first = packet()
        analysis.process(result(), NAMES, first)
        worker.observe(CAMERA, first, analysis.context)
        worker.run_once()
        worker.run_once()
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
