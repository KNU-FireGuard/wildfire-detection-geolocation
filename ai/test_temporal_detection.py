import unittest

from ai.inference.temporal_detection import FrameSampler, TemporalDetectionGate


def detection(class_name="fire", bbox=(10, 10, 50, 50)):
    return {"class": class_name, "bbox": bbox, "confidence": 0.9}


class TemporalGateTests(unittest.TestCase):
    def test_requires_full_window_and_accepts_sixteen_hits(self):
        gate = TemporalDetectionGate()
        for i in range(19):
            self.assertEqual(gate.update(i / 5, [detection()] if i < 15 else []), [])
        self.assertEqual(gate.update(3.8, [detection()]), [0])
        self.assertEqual(gate.update(4.0, [detection()]), [0])

    def test_fifteen_hits_do_not_confirm(self):
        gate = TemporalDetectionGate()
        for i in range(20):
            self.assertEqual(gate.update(i / 5, [detection()] if i < 15 else []), [])

    def test_duplicate_boxes_do_not_count_as_multiple_frames(self):
        gate = TemporalDetectionGate()
        for i in range(20):
            boxes = [detection(), detection()] if i % 2 else []
            self.assertEqual(gate.update(i / 5, boxes), [])

    def test_classes_and_distant_locations_are_separate(self):
        gate = TemporalDetectionGate()
        for i in range(20):
            candidate = detection("fire" if i % 2 else "smoke")
            self.assertEqual(gate.update(i / 5, [candidate]), [])
        gate = TemporalDetectionGate()
        for i in range(20):
            box = (10, 10, 50, 50) if i % 2 else (300, 300, 340, 340)
            self.assertEqual(gate.update(i / 5, [detection(bbox=box)]), [])

    def test_slowly_moving_smoke_is_associated(self):
        gate = TemporalDetectionGate()
        for i in range(20):
            result = gate.update(i / 5, [detection("smoke", (10 + i, 10, 50 + i, 50))])
        self.assertEqual(result, [0])

    def test_gap_backwards_timestamp_and_explicit_reset_discard_history(self):
        for mode in ("gap", "backwards", "reset"):
            with self.subTest(mode=mode):
                gate = TemporalDetectionGate()
                for i in range(19):
                    gate.update(i / 5, [detection()])
                if mode == "reset":
                    gate.reset()
                timestamp = {"gap": 10, "backwards": 0, "reset": 3.8}[mode]
                self.assertEqual(gate.update(timestamp, [detection()]), [])

    def test_no_detection_after_confirmation_does_not_send_stale_box(self):
        gate = TemporalDetectionGate()
        for i in range(20):
            gate.update(i / 5, [detection()])
        self.assertEqual(gate.update(4, []), [])


class SamplingTests(unittest.TestCase):
    def test_samples_five_frames_per_second_independent_of_source_fps(self):
        for fps in (25, 30, 60):
            sampler = FrameSampler()
            selected = [i for i in range(fps * 4) if sampler.accept(i / fps)]
            self.assertEqual(len(selected), 20)

    def test_does_not_duplicate_frames_after_gap(self):
        sampler = FrameSampler()
        self.assertTrue(sampler.accept(0))
        self.assertFalse(sampler.accept(0))
        self.assertTrue(sampler.accept(10))
        self.assertFalse(sampler.accept(10))


if __name__ == "__main__":
    unittest.main()
