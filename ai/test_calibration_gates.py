"""자세 보정 신뢰성 게이트 (#56): 판정 기준은 docs/RayCasting_DEM_Architecture.md 2.2절"""
from __future__ import annotations

import unittest

import numpy as np

from ai.dem_skyline_engine import DEMProvider

W, H, FOV = 1920, 1080, 60.0
TRUE = (99.2, 1.3, 0.8)


class TestBlindPoseFailureReasons(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.provider = DEMProvider()

    def test_too_few_points_reports_insufficient_ridge(self) -> None:
        ridge = self.provider.synthesize_observed_skyline(*TRUE, noise_std_px=0.0)[:10]
        res = self.provider.estimate_blind_ptz(ridge, W, H, FOV)
        self.assertEqual(res["status"], "CALIBRATION_FAILED")
        self.assertEqual(res["reason"], "INSUFFICIENT_RIDGE")

    def test_flat_line_reports_low_relief(self) -> None:
        xs = np.arange(100, 1820, 20, dtype=np.float64)
        res = self.provider.estimate_blind_ptz(np.column_stack([xs, np.full_like(xs, 540.0)]), W, H, FOV)
        self.assertEqual(res["status"], "CALIBRATION_FAILED")
        self.assertEqual(res["reason"], "LOW_RELIEF")

    def test_tilt_outside_range_reports_reason(self) -> None:
        ridge = self.provider.synthesize_observed_skyline(*TRUE, noise_std_px=0.0)
        res = self.provider.estimate_blind_ptz(ridge, W, H, FOV, max_tilt_deg=0.5)
        self.assertEqual(res["status"], "CALIBRATION_FAILED")
        self.assertEqual(res["reason"], "TILT_OUT_OF_RANGE")

    def test_success_has_no_reason(self) -> None:
        ridge = self.provider.synthesize_observed_skyline(*TRUE, noise_std_px=0.5)
        res = self.provider.estimate_blind_ptz(ridge, W, H, FOV)
        self.assertEqual(res["status"], "OK")
        self.assertIsNone(res["reason"])


class TestEstimatorExposesReason(unittest.TestCase):
    def test_calibration_failure_reason_reaches_estimator_result(self) -> None:
        from ai.fire_location_estimator import FireLocationEstimator

        xs = np.arange(100, 1820, 20, dtype=np.float64)
        meta = {
            "camera": {"lat": 35.791037, "lon": 128.591184, "tower_height": 15.0, "fov_h": FOV},
            "ridge_pts": np.column_stack([xs, np.full_like(xs, 540.0)]),
        }
        res = FireLocationEstimator().estimate_location([0.45, 0.30, 0.55, 0.50], meta)
        self.assertEqual(res["status"], "CALIBRATION_FAILED")
        self.assertEqual(res["reason"], "LOW_RELIEF")


if __name__ == "__main__":
    unittest.main()
