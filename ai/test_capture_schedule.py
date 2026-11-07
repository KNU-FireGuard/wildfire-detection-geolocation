import unittest
import numpy as np
from types import SimpleNamespace
from unittest.mock import patch
from ai.inference import backend_connect as bc
from ai.inference.backend_connect import CaptureSchedule
from ai.test_backend_connect import _Box, _Result, NAMES


class CaptureScheduleTests(unittest.TestCase):
    def test_no_capture_until_twentieth_sample_is_confirmed(self):
        args = SimpleNamespace(run_id=1, camera_id=2, confidence=.3, smoke_confidence=.5,
                               result_url='http://test/detections', capture_url='http://test/captures',
                               stream_width=960, jpeg_quality=80)
        gate = bc.TemporalDetectionGate()
        result = _Result([_Box(0, .8, [1, 1, 20, 20])])
        result.orig_img = np.zeros((32, 32, 3), dtype=np.uint8)
        with patch.object(bc, 'encode_frame', return_value=b'jpeg'), patch.object(bc.requests, 'post') as post:
            uploader = bc.CaptureUploader(args, {}, autostart=False)
            for index in range(19):
                bc.send_detections(SimpleNamespace(names=NAMES), result, args, {}, [0],
                                   gate=gate, timestamp=index / 5, capture_uploader=uploader)
            post.assert_not_called()
            bc.send_detections(SimpleNamespace(names=NAMES), result, args, {}, [0],
                               gate=gate, timestamp=3.8, capture_uploader=uploader)
            self.assertEqual(post.call_count, 1)
            uploader.run_once()
            self.assertEqual(post.call_count, 2)
            self.assertEqual(post.call_args.kwargs['headers']['X-Video-Time-Ms'], '3800')
            uploader.close()

    def test_first_capture_then_five_video_seconds_per_class(self):
        schedule = CaptureSchedule()
        self.assertTrue(schedule.due('smoke', 3.8))
        schedule.saved('smoke', 3.8)
        self.assertFalse(schedule.due('smoke', 8.799))
        self.assertTrue(schedule.due('smoke', 8.8))
        self.assertTrue(schedule.due('fire', 4.0))
        self.assertFalse(schedule.due('smoke', 2.0))

    def test_unreserved_frame_does_not_consume_capture_interval(self):
        schedule = CaptureSchedule()
        self.assertTrue(schedule.due('fire', 10))
        self.assertTrue(schedule.due('fire', 10.2))

    def test_confirmed_callbacks_continue_but_jpeg_is_uploaded_only_every_five_seconds(self):
        args = SimpleNamespace(run_id=1, camera_id=2, confidence=.3, smoke_confidence=.5,
                               result_url='http://test/detections', capture_url='http://test/captures',
                               stream_width=960, jpeg_quality=80)
        payload = bc.detection_payload(1, 2, 'smoke', .9, [1, 2, 3, 4])
        counter = [0]
        with patch.object(bc, 'frame_detections', return_value=[payload]), \
             patch.object(bc, 'encode_frame', return_value=b'jpeg'), \
             patch.object(bc.requests, 'post') as post:
            uploader = bc.CaptureUploader(args, {}, autostart=False)
            for timestamp in [3.8, 4.0, 8.6, 8.8]:
                bc.send_detections(SimpleNamespace(names={}), object(), args, {}, counter,
                                   timestamp=timestamp, capture_uploader=uploader)
            while uploader.run_once():
                pass
            images = [call for call in post.call_args_list if 'data' in call.kwargs]
            self.assertEqual(counter, [4])
            self.assertEqual([call.kwargs['headers']['X-Video-Time-Ms'] for call in images], ['3800', '8800'])
            self.assertTrue(all(call.args[0].endswith('/smoke') for call in images))
            uploader.close()

    def test_capture_failure_does_not_fail_detection_callback(self):
        args = SimpleNamespace(run_id=1, camera_id=2, confidence=.3, smoke_confidence=.5,
                               result_url='http://test/detections', capture_url='http://test/captures',
                               stream_width=960, jpeg_quality=80)
        payload = bc.detection_payload(1, 2, 'fire', .9, [1, 2, 3, 4])
        counter = [0]
        with patch.object(bc, 'frame_detections', return_value=[payload]), \
             patch.object(bc, 'encode_frame', side_effect=RuntimeError('encode failed')), \
             patch.object(bc.requests, 'post') as post:
            uploader = bc.CaptureUploader(args, {}, autostart=False)
            bc.send_detections(SimpleNamespace(names={}), object(), args, {}, counter,
                               timestamp=4, capture_uploader=uploader)
            uploader.run_once()
            self.assertEqual(counter, [1])
            self.assertEqual(post.call_count, 1)
            uploader.close()


if __name__ == '__main__':
    unittest.main()
