import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from ai.inference import backend_connect as bc


def arguments():
    return SimpleNamespace(capture_url='http://test/captures', stream_width=960, jpeg_quality=80,
                           result_url='http://test/detections', run_id=1, camera_id=2, confidence=.3, smoke_confidence=.5)


class CaptureUploaderTests(unittest.TestCase):
    def test_slow_http_does_not_block_next_detection(self):
        entered, release = threading.Event(), threading.Event()
        detections = []
        def post(url, **kwargs):
            if '/captures/' in url:
                entered.set()
                release.wait(2)
            else:
                detections.append(url)
            return SimpleNamespace(raise_for_status=lambda: None)
        args = arguments()
        payload = bc.detection_payload(1, 2, 'fire', .9, [1, 1, 20, 20])
        with patch.object(bc, 'encode_frame', return_value=b'jpeg'), patch.object(bc.requests, 'post', side_effect=post), \
             patch.object(bc, 'frame_detections', return_value=[payload]):
            uploader = bc.CaptureUploader(args, {})
            try:
                count = [0]
                bc.send_detections(SimpleNamespace(names={}), object(), args, {}, count, timestamp=3.8, capture_uploader=uploader)
                self.assertTrue(entered.wait(1))
                bc.send_detections(SimpleNamespace(names={}), object(), args, {}, count, timestamp=4, capture_uploader=uploader)
                self.assertEqual(count, [2])
                self.assertEqual(len(detections), 2)
                self.assertFalse(release.is_set())
            finally:
                release.set()
                uploader.close()

    def test_normal_close_drains_queued_captures_before_worker_exit(self):
        sent = []
        with patch.object(bc, 'encode_frame', return_value=b'jpeg'):
            uploader = bc.CaptureUploader(arguments(), {}, post=lambda url, **kwargs:
                sent.append(url) or SimpleNamespace(raise_for_status=lambda: None))
            uploader.submit('fire', 0, object())
            uploader.submit('smoke', 0, object())
            uploader.close()
        self.assertEqual(sent, ['http://test/captures/fire', 'http://test/captures/smoke'])
        self.assertFalse(uploader.worker.is_alive())

    def test_drain_timeout_drops_pending_work_and_prevents_late_upload(self):
        entered, release = threading.Event(), threading.Event()
        def encode(*args):
            entered.set()
            release.wait(2)
            return b'jpeg'
        with patch.object(bc, 'encode_frame', side_effect=encode), patch.object(bc.requests, 'post') as post:
            uploader = bc.CaptureUploader(arguments(), {})
            uploader.submit('fire', 0, object())
            try:
                self.assertTrue(entered.wait(1))
                uploader.submit('smoke', 0, object())
                uploader.close(timeout=0)
                self.assertTrue(uploader.pending.empty())
            finally:
                release.set()
                uploader.worker.join(1)
            self.assertFalse(uploader.worker.is_alive())
            post.assert_not_called()

    def test_slow_upload_and_encoding_do_not_block_next_detection(self):
        entered, release = threading.Event(), threading.Event()
        calls = []
        def encode(*args):
            entered.set()
            release.wait(2)
            return b'jpeg'
        def post(url, **kwargs):
            calls.append(url)
            return SimpleNamespace(raise_for_status=lambda: None)
        args = arguments()
        payload = bc.detection_payload(1, 2, 'smoke', .9, [1, 1, 20, 20])
        with patch.object(bc, 'encode_frame', side_effect=encode), patch.object(bc.requests, 'post', side_effect=post), \
             patch.object(bc, 'frame_detections', return_value=[payload]):
            uploader = bc.CaptureUploader(args, {})
            try:
                count = [0]
                bc.send_detections(SimpleNamespace(names={}), object(), args, {}, count, timestamp=3.8, capture_uploader=uploader)
                self.assertTrue(entered.wait(1))
                bc.send_detections(SimpleNamespace(names={}), object(), args, {}, count, timestamp=4, capture_uploader=uploader)
                self.assertEqual(count, [2])
                self.assertEqual(calls, ['http://test/detections', 'http://test/detections'])
            finally:
                release.set()
                uploader.close()
            self.assertEqual(calls[-1], 'http://test/captures/smoke')

    def test_bounded_queue_and_video_time_cadence(self):
        uploader = bc.CaptureUploader(arguments(), {}, autostart=False, max_pending=2)
        self.assertTrue(uploader.submit('smoke', 3.8, object()))
        self.assertFalse(uploader.submit('smoke', 8.799, object()))
        self.assertTrue(uploader.submit('smoke', 8.8, object()))
        self.assertFalse(uploader.submit('fire', 4, object()))
        self.assertEqual(uploader.pending.qsize(), 2)
        uploader.close()

    def test_failure_cooldown_skips_queued_retries_and_is_per_class(self):
        current = [0]
        posts = []
        def post(url, **kwargs):
            posts.append(url)
            raise bc.requests.Timeout('simulated failure')
        uploader = bc.CaptureUploader(arguments(), {}, autostart=False, max_pending=4,
                                      clock=lambda: current[0], post=post)
        with patch.object(bc, 'encode_frame', return_value=b'jpeg'):
            uploader.submit('smoke', 0, object())
            uploader.submit('smoke', 5, object())
            uploader.run_once()
            uploader.run_once()
            self.assertEqual(len(posts), 1)
            current[0] = 4.999
            self.assertFalse(uploader.submit('smoke', 10, object()))
            self.assertTrue(uploader.submit('fire', 0, object()))
            current[0] = 5
            self.assertTrue(uploader.submit('smoke', 10, object()))
        uploader.close()

    def test_snapshot_keeps_original_frame_and_timestamp(self):
        original = np.array([1, 2], dtype=np.uint8)
        result = SimpleNamespace(cpu=lambda: SimpleNamespace(orig_img=original))
        sent = []
        uploader = bc.CaptureUploader(arguments(), {}, autostart=False,
            post=lambda url, **kwargs: sent.append((url, kwargs)) or SimpleNamespace(raise_for_status=lambda: None))
        uploader.submit('fire', 8.8, result)
        original[:] = 9
        with patch.object(bc, 'encode_frame', side_effect=lambda result, *_: result.orig_img.tobytes()):
            uploader.run_once()
        self.assertEqual(sent[0][0], 'http://test/captures/fire')
        self.assertEqual(sent[0][1]['data'], bytes([1, 2]))
        self.assertEqual(sent[0][1]['headers']['X-Video-Time-Ms'], '8800')
        uploader.close()

    def test_expired_job_and_closed_uploader_do_not_send(self):
        current = [0]
        uploader = bc.CaptureUploader(arguments(), {}, autostart=False, clock=lambda: current[0], post=lambda *_: self.fail('stale upload'))
        uploader.submit('smoke', 0, object())
        current[0] = 16
        uploader.run_once()
        uploader.close()
        self.assertFalse(uploader.submit('fire', 0, object()))


if __name__ == '__main__':
    unittest.main()
