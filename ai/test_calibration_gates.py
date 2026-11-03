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


class TestBlindPoseUniqueness(unittest.TestCase):
    """1순위에서 Pan 5° 이상 떨어진 최적 후보 잔차 / 1순위 잔차 >= 1.3 이어야 OK"""

    def test_periodic_skyline_is_ambiguous(self) -> None:
        provider = DEMProvider()
        # 30°마다 같은 모양이 반복되는 인공 능선: 어느 방향인지 구별할 근거가 없음
        provider.skyline_el_deg = 4.0 + 3.0 * np.sin(np.radians(provider.az_grid) * 12.0)
        ridge = provider.synthesize_observed_skyline(*TRUE, noise_std_px=0.5)
        res = provider.estimate_blind_ptz(ridge, W, H, FOV)
        self.assertEqual(res["status"], "CALIBRATION_FAILED")
        self.assertEqual(res["reason"], "AMBIGUOUS_POSE")
        self.assertLess(res["uniqueness_ratio"], 1.3)

    def test_real_dem_skyline_is_unique(self) -> None:
        provider = DEMProvider()
        ridge = provider.synthesize_observed_skyline(*TRUE, noise_std_px=0.5)
        res = provider.estimate_blind_ptz(ridge, W, H, FOV)
        self.assertEqual(res["status"], "OK")
        self.assertGreaterEqual(res["uniqueness_ratio"], 1.3)


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
