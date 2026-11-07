"""영상 시각에 따른 샘플링과 추론→확정→콜백 연결 검증 (YOLO 가중치 불필요)."""
import queue
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np

from ai.inference import backend_connect as bc
from ai.test_backend_connect import _Box, _Result, NAMES


class Capture:
    def __init__(self, fps=30, timestamps=True):
        self.fps = fps
        self.timestamps = timestamps
        self.index = 0
        self.released = False
        self.frame = np.zeros((32, 32, 3), dtype=np.uint8)

    def isOpened(self):
        return True

    def get(self, key):
        if key == cv2.CAP_PROP_FPS:
            return self.fps
        return (self.index - 1) / self.fps * 1000 if self.timestamps else 0

    def read(self):
        self.index += 1
        return (True, self.frame) if self.index <= self.fps * 4 else (False, None)

    def release(self):
        self.released = True


class VideoSamplingTests(unittest.TestCase):
    def test_video_timestamps_and_missing_timestamp_fallback(self):
        for fps, timestamps in ((25, True), (30, True), (60, False)):
            capture = Capture(fps, timestamps)
            with patch.object(cv2, "VideoCapture", return_value=capture):
                frames = list(bc.sampled_video_frames("unused.mp4", threading.Event()))
            self.assertEqual(len(frames), 20)
            self.assertAlmostEqual(frames[-1][0], 3.8, places=2)
            self.assertTrue(capture.released)

    def test_invalid_source_rate_fails_instead_of_inventing_frames(self):
        capture = Capture(2)
        with patch.object(cv2, "VideoCapture", return_value=capture):
            with self.assertRaisesRegex(RuntimeError, "FPS >= 5"):
                list(bc.sampled_video_frames("unused.mp4", threading.Event()))
        self.assertTrue(capture.released)

    def test_inference_sends_first_callback_on_twentieth_sample(self):
        capture = Capture()
        output = queue.Queue()
        result = _Result([_Box(0, 0.7, [1, 1, 20, 20])], shape=capture.frame.shape)
        calls = []

        def predict(**kwargs):
            calls.append(kwargs)
            return [result]

        model = SimpleNamespace(names=NAMES, predict=predict)
        args = SimpleNamespace(source_path="unused.mp4", confidence=0.3, smoke_confidence=0.5,
                               iou=0.45, image_size=640, device="cpu", run_id=1, camera_id=2, result_url="http://x")
        counter = [0]
        with patch.object(cv2, "VideoCapture", return_value=capture), \
             patch.object(bc, "filter_result_boxes"), patch.object(bc.requests, "post") as post:
            post.side_effect = lambda *a, **kw: self.assertEqual(len(calls), 20) or SimpleNamespace(raise_for_status=lambda: None)
            bc.infer_frames(model, args, {}, counter, output, threading.Event())
        items = list(output.queue)
        self.assertIsNone(items[-1])
        self.assertEqual(len(items), 21)
        self.assertEqual(len(calls), 20)
        self.assertTrue(all(isinstance(call["source"], np.ndarray) for call in calls))
        self.assertEqual(counter, [1])


if __name__ == "__main__":
    unittest.main()
