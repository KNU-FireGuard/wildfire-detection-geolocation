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


class TestReliefThreshold(unittest.TestCase):
    """능선 고도각 표준편차 0.35° 미만은 LOW_RELIEF (#51의 0.12° 타협 복원)"""

    def test_nearly_flat_skyline_is_rejected(self) -> None:
        """
        기복이 거의 없는 능선(정확한 기복 약 0.09°)은 OK가 아니어야 함
        0.12° 기준에서는 틀린 자세에서 잰 기복이 부풀려져(약 0.14°) OK로 통과했음
        """
        from ai.camera_model import pixel_to_direction

        provider = DEMProvider()
        sky = provider.skyline_el_deg
        provider.skyline_el_deg = float(np.mean(sky)) + (sky - np.mean(sky)) * 0.03
        ridge = provider.synthesize_observed_skyline(*TRUE, noise_std_px=0.0)
        _, el = pixel_to_direction(ridge[:, 0], ridge[:, 1], *TRUE, W, H, FOV)
        self.assertLess(float(np.std(el)), 0.12, "테스트 장면의 실제 기복이 0.12° 미만이어야 함")
        res = provider.estimate_blind_ptz(ridge, W, H, FOV)
        self.assertEqual(res["status"], "CALIBRATION_FAILED")
        self.assertEqual(res["reason"], "LOW_RELIEF")


class TestRidgeCoverage(unittest.TestCase):
    """능선 점의 가로 범위가 15° 미만이면 형상 비교 근거 부족"""

    def test_narrow_ridge_reports_insufficient_coverage(self) -> None:
        provider = DEMProvider()
        xs = np.linspace(860.0, 1060.0, 20)  # 약 7° 범위에 20점
        ys = provider.skyline_y_at(xs, *TRUE, W, H, FOV)
        res = provider.estimate_blind_ptz(np.column_stack([xs, ys]), W, H, FOV)
        self.assertEqual(res["status"], "CALIBRATION_FAILED")
        self.assertEqual(res["reason"], "INSUFFICIENT_COVERAGE")


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


class TestZeroPointCalibrationGate(unittest.TestCase):
    """PTZ 제공 시 영점 보정은 품질 검사를 통과할 때만 적용"""

    @classmethod
    def setUpClass(cls) -> None:
        cls.provider = DEMProvider()
        cls.ridge = cls.provider.synthesize_observed_skyline(*TRUE, noise_std_px=0.5)

    def test_good_ridge_is_calibrated(self) -> None:
        res = self.provider.calibrate_ptz_zero_point(TRUE[0] - 1.0, TRUE[1] - 1.0, self.ridge, W, H, FOV)
        self.assertTrue(res["calibrated"])
        self.assertIsNone(res["reason"])

    def test_solution_at_search_boundary_is_not_applied(self) -> None:
        """실제 Pan이 탐색 범위(±5°) 밖이면 경계에 붙은 해를 적용하지 않음"""
        res = self.provider.calibrate_ptz_zero_point(TRUE[0] - 7.0, TRUE[1], self.ridge, W, H, FOV)
        self.assertFalse(res["calibrated"])
        self.assertEqual(res["reason"], "AT_SEARCH_BOUNDARY")

    def test_too_few_points_is_not_applied(self) -> None:
        res = self.provider.calibrate_ptz_zero_point(TRUE[0], TRUE[1], self.ridge[:10], W, H, FOV)
        self.assertFalse(res["calibrated"])
        self.assertEqual(res["reason"], "INSUFFICIENT_RIDGE")

    def test_estimator_keeps_given_ptz_when_calibration_fails(self) -> None:
        from ai.fire_location_estimator import FireLocationEstimator

        given = {"pan": TRUE[0] - 7.0, "tilt": TRUE[1], "roll": 0.0}
        meta = {
            "camera": {"lat": 35.791037, "lon": 128.591184, "tower_height": 15.0, "fov_h": FOV, "near_m": 30.0},
            "ptz": given,
            "ridge_pts": self.ridge,
        }
        res = FireLocationEstimator().estimate_location([0.52, 0.59, 0.56, 0.69], meta, bbox_normalized=True)
        cal = res["calibration"]
        self.assertFalse(cal["calibrated"])
        self.assertEqual(cal["reason"], "AT_SEARCH_BOUNDARY")
        self.assertAlmostEqual(cal["pan"], given["pan"], places=9)
        self.assertAlmostEqual(cal["tilt"], given["tilt"], places=9)


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
