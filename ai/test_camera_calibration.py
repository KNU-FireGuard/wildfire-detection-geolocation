"""카메라 보정 도구 (#58, docs/Camera_Calibration.md)"""
from __future__ import annotations

import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from ai.camera_calibration import CalibrationJobError, load_calibration_job

JOB = {
    "version": 1,
    "camera": {"key": "test-cam", "name": "테스트", "camera_id": None, "lat": 35.791037, "lon": 128.591184},
    "fov_search_deg": [40.0, 60.0],
    "fov_step_deg": 2.0,
    "views": [
        {"id": "V1", "frame": "frames/v1.png", "preset": "P339/T03", "label_pan": 339.0},
        {"id": "V2", "frame": "frames/v2.png"},
    ],
    "landmarks": [
        {"name": "A", "lat": 35.7911, "lon": 128.5920, "height_m": 6.0, "view": "V1", "px": [600, 875], "use": "fit"},
        {"name": "E", "lat": 35.7903, "lon": 128.5938, "view": "V1", "px": [1200, 905], "use": "val"},
    ],
}


class TestCalibrationJobLoader(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(self.dir, ignore_errors=True))

    def _write(self, data: dict) -> Path:
        p = self.dir / "job.json"
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return p

    def test_valid_job_is_loaded_with_defaults_and_resolved_paths(self) -> None:
        job = load_calibration_job(self._write(JOB), base_dir=self.dir)
        self.assertEqual(job["camera"]["key"], "test-cam")
        self.assertEqual(job["views"][0]["frame"], self.dir / "frames/v1.png")
        self.assertEqual(job["landmarks"][1]["height_m"], 0.0)
        self.assertEqual([lm["use"] for lm in job["landmarks"]], ["fit", "val"])

    def _assert_rejected(self, mutate) -> None:
        bad = copy.deepcopy(JOB)
        mutate(bad)
        with self.assertRaises(CalibrationJobError):
            load_calibration_job(self._write(bad), base_dir=self.dir)

    def test_missing_camera_coordinate_is_rejected(self) -> None:
        self._assert_rejected(lambda j: j["camera"].pop("lat"))

    def test_landmark_on_unknown_view_is_rejected(self) -> None:
        self._assert_rejected(lambda j: j["landmarks"][0].update(view="V9"))

    def test_invalid_landmark_use_is_rejected(self) -> None:
        self._assert_rejected(lambda j: j["landmarks"][0].update(use="both"))

    def test_invalid_fov_range_is_rejected(self) -> None:
        self._assert_rejected(lambda j: j.update(fov_search_deg=[60.0, 40.0]))

    def test_duplicate_view_id_is_rejected(self) -> None:
        self._assert_rejected(lambda j: j["views"][1].update(id="V1"))

    def test_empty_views_are_rejected(self) -> None:
        self._assert_rejected(lambda j: j.update(views=[], landmarks=[]))


if __name__ == "__main__":
    unittest.main()
