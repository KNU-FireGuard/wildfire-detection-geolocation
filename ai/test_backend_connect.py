"""
AI 실행 코드의 위치 추정 연결 테스트 (#60)

- YOLO·OpenCV 없이 가짜 탐지 결과와 가짜 세션으로 탐지 JSON 구성만 검증
"""
import tempfile
import unittest
from pathlib import Path

from ai.inference import backend_connect as bc


class _Scalar:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class _Coords:
    def __init__(self, xyxy):
        self.xyxy = xyxy

    def __getitem__(self, index):
        assert index == 0
        return self

    def tolist(self):
        return list(self.xyxy)


class _Box:
    def __init__(self, cls_id, conf, xyxy):
        self.cls = _Scalar(cls_id)
        self.conf = _Scalar(conf)
        self.xyxy = _Coords(xyxy)


class _Result:
    def __init__(self, boxes, shape=(1080, 1920, 3)):
        self.boxes = boxes
        self.orig_img = _Frame(shape)


class _Frame:
    def __init__(self, shape):
        self.shape = shape


class _FakeSession:
    def __init__(self, location=None, status=None):
        self.location = location
        self.status = status or {"ready": True, "mode": "config_fixed_pose", "warnings": []}
        self.prepared = []
        self.located = []

    def prepare(self, frame=None, frame_size=None):
        self.prepared.append(frame_size)
        return self.status

    def locate(self, bbox):
        self.located.append(list(bbox))
        return self.location


NAMES = {0: "fire", 1: "smoke", 2: "person"}


class DetectionPayloadTests(unittest.TestCase):
    def test_location_is_null_by_default(self):
        payload = bc.detection_payload(1, 2, "smoke", 0.9, [1, 2, 3, 4])
        self.assertIsNone(payload["location_estimation"])

    def test_location_is_included(self):
        loc = {"latitude": 36.4, "longitude": 128.6, "error_range_m": None}
        payload = bc.detection_payload(1, 2, "smoke", 0.9, [1, 2, 3, 4], location=loc)
        self.assertEqual(payload["location_estimation"], loc)


class FrameDetectionsTests(unittest.TestCase):
    def test_each_fire_smoke_box_gets_location_from_session(self):
        loc = {"latitude": 36.4, "longitude": 128.6, "error_range_m": None}
        session = _FakeSession(location=loc)
        result = _Result([_Box(1, 0.8, [10, 20, 30, 40]), _Box(2, 0.9, [0, 0, 5, 5]), _Box(0, 0.7, [1, 1, 2, 2])])
        payloads = bc.frame_detections(result, NAMES, run_id=5, camera_id=3, session=session)
        self.assertEqual([p["detection"]["class"] for p in payloads], ["smoke", "fire"])
        self.assertEqual([p["location_estimation"] for p in payloads], [loc, loc])
        # 원본 픽셀 xyxy 그대로 세션에 전달, 사람 등 다른 클래스는 위치 계산 안 함
        self.assertEqual(session.located, [[10, 20, 30, 40], [1, 1, 2, 2]])

    def test_without_session_location_is_null(self):
        result = _Result([_Box(1, 0.8, [10, 20, 30, 40])])
        payloads = bc.frame_detections(result, NAMES, run_id=5, camera_id=3, session=None)
        self.assertIsNone(payloads[0]["location_estimation"])

    def test_no_boxes(self):
        self.assertEqual(bc.frame_detections(_Result(None), NAMES, 5, 3, None), [])


class PrepareLocationTests(unittest.TestCase):
    def test_prepare_uses_original_frame_size(self):
        session = _FakeSession()
        status = bc.prepare_location(session, _Result([], shape=(720, 1280, 3)))
        self.assertEqual(session.prepared, [(1280, 720)])
        self.assertTrue(status["ready"])

    def test_prepare_failure_returns_none_session(self):
        class Broken(_FakeSession):
            def prepare(self, frame=None, frame_size=None):
                raise RuntimeError("DEM 다운로드 실패")

        self.assertIsNone(bc.prepare_location(Broken(), _Result([])))
        self.assertIsNone(bc.prepare_location(None, _Result([])))


class ParseArgsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.video = Path(self.tmp.name) / "v.mp4"
        self.model = Path(self.tmp.name) / "m.pt"
        self.video.write_bytes(b"v")
        self.model.write_bytes(b"m")
        self.base = [
            "--run-id", "1", "--camera-id", "2", "--source-path", str(self.video),
            "--video-url", "http://x/video", "--result-url", "http://x/det", "--model-path", str(self.model),
            "--device", "cpu",  # 장치 자동 선택(torch import)을 건너뜀
        ]

    def tearDown(self):
        self.tmp.cleanup()

    def test_camera_args_are_optional(self):
        args = bc.parse_args(self.base)
        self.assertIsNone(args.camera_lat)
        self.assertIsNone(args.camera_lon)
        self.assertIsNone(args.camera_name)

    def test_camera_args(self):
        args = bc.parse_args(self.base + ["--camera-name", "경북의성", "--camera-lat", "36.382", "--camera-lon", "128.5779"])
        self.assertEqual((args.camera_name, args.camera_lat, args.camera_lon), ("경북의성", 36.382, 128.5779))

    def test_lat_without_lon_is_error(self):
        with self.assertRaises(SystemExit):
            bc.parse_args(self.base + ["--camera-lat", "36.4"])

    def test_out_of_range_is_error(self):
        with self.assertRaises(SystemExit):
            bc.parse_args(self.base + ["--camera-lat", "91", "--camera-lon", "128"])


if __name__ == "__main__":
    unittest.main()
