from __future__ import annotations

import math
import unittest

import numpy as np

from ai.camera_model import direction_to_pixel, focal_length_px, pixel_to_direction

W, H, FOV = 1920, 1080, 60.0


class TestPinholeRotationModel(unittest.TestCase):
    """정식 핀홀 회전 모델: 해석해와 비교, 왕복 일관성, Roll 부호 규약"""

    def test_center_pixel_points_along_pan_tilt(self) -> None:
        az, el = pixel_to_direction(W / 2, H / 2, 123.4, 5.6, 1.5, W, H, FOV)
        self.assertAlmostEqual(float(az), 123.4, places=9)
        self.assertAlmostEqual(float(el), 5.6, places=9)

    def test_edge_pixel_elevation_matches_closed_form(self) -> None:
        """Tilt·Roll 0일 때 가장자리 픽셀 고도각 = atan(dy / sqrt(f^2 + dx^2)), 근사식 atan(dy / f)와 다름"""
        f = focal_length_px(W, FOV)
        dx = W / 2  # 화면 오른쪽 끝 (가로 30°)
        dy = f * math.tan(math.radians(10.0))  # 근사식이라면 고도각 10°
        az, el = pixel_to_direction(W / 2 + dx, H / 2 - dy, 0.0, 0.0, 0.0, W, H, FOV)
        self.assertAlmostEqual(float(az), math.degrees(math.atan(dx / f)), places=9)
        self.assertAlmostEqual(float(el), math.degrees(math.atan(dy / math.hypot(f, dx))), places=9)
        self.assertLess(float(el), 9.0)  # 실제 약 8.7°: 근사식 10°와 1.3° 차이

    def test_center_column_with_tilt_is_pure_pitch(self) -> None:
        f = focal_length_px(W, FOV)
        _, el = pixel_to_direction(W / 2, H / 2 - 200.0, 40.0, 7.0, 0.0, W, H, FOV)
        self.assertAlmostEqual(float(el), 7.0 + math.degrees(math.atan(200.0 / f)), places=9)

    def test_positive_roll_lowers_right_side_of_horizon(self) -> None:
        """기존 코드와 같은 규약: Roll이 양수면 화면 오른쪽의 수평선이 아래(y 증가)로 내려감"""
        x, y, front = direction_to_pixel(20.0, 0.0, 0.0, 0.0, 2.0, W, H, FOV)
        self.assertTrue(bool(front))
        self.assertGreater(float(x), W / 2)
        self.assertGreater(float(y), H / 2)

    def test_round_trip_pixel_direction_pixel(self) -> None:
        rng = np.random.default_rng(0)
        xs = rng.uniform(0, W, 200)
        ys = rng.uniform(0, H, 200)
        pose = (321.0, -4.0, 2.2)
        az, el = pixel_to_direction(xs, ys, *pose, W, H, FOV)
        x2, y2, front = direction_to_pixel(az, el, *pose, W, H, FOV)
        self.assertTrue(bool(np.all(front)))
        np.testing.assert_allclose(x2, xs, atol=1e-6)
        np.testing.assert_allclose(y2, ys, atol=1e-6)

    def test_direction_behind_camera_is_flagged(self) -> None:
        _, _, front = direction_to_pixel(180.0, 0.0, 0.0, 0.0, 0.0, W, H, FOV)
        self.assertFalse(bool(front))


class TestEstimatorRayUsesRotationModel(unittest.TestCase):
    """위치 추정기의 광선 계산이 정식 회전 모델과 일치해야 함"""

    def test_edge_pixel_ray_matches_closed_form(self) -> None:
        from ai.fire_location_estimator import FireLocationEstimator

        f = focal_length_px(W, FOV)
        dy = f * math.tan(math.radians(10.0))
        (dx_, dy_, dz_), bearing, el = FireLocationEstimator.compute_3d_ray_vector(
            fire_x=W, fire_y=H / 2 - dy, pan_deg=0.0, tilt_deg=0.0, roll_deg=0.0, width=W, height=H, fov_h_deg=FOV
        )
        expected_el = math.degrees(math.atan(dy / math.hypot(f, W / 2)))
        self.assertAlmostEqual(el, expected_el, places=6)
        self.assertAlmostEqual(bearing, math.degrees(math.atan((W / 2) / f)), places=6)
        self.assertAlmostEqual(math.sqrt(dx_ ** 2 + dy_ ** 2 + dz_ ** 2), 1.0, places=9)

    def test_ray_agrees_with_model_for_tilted_rolled_camera(self) -> None:
        from ai.fire_location_estimator import FireLocationEstimator

        pose = (98.7, 2.5, 2.3)
        for px, py in [(100.0, 900.0), (1800.0, 150.0), (960.0, 540.0)]:
            _, bearing, el = FireLocationEstimator.compute_3d_ray_vector(px, py, *pose, width=W, height=H, fov_h_deg=FOV)
            az_m, el_m = pixel_to_direction(px, py, *pose, W, H, FOV)
            self.assertAlmostEqual(bearing, float(az_m), places=6)
            self.assertAlmostEqual(el, float(el_m), places=6)


class TestSyntheticSkylineUsesRotationModel(unittest.TestCase):
    """합성 능선 픽셀을 정식 모델로 되돌리면 DEM 가상 능선 위에 놓여야 함"""

    POSE = (99.2, 2.0, 2.0)

    @staticmethod
    def _skyline_el_at(provider, az):
        az_ext = np.append(provider.az_grid, 360.0)
        sky_ext = np.append(provider.skyline_el_deg, provider.skyline_el_deg[0])
        return np.interp(np.asarray(az) % 360.0, az_ext, sky_ext)

    def _assert_on_skyline(self, provider, pts) -> None:
        az, el = pixel_to_direction(pts[:, 0], pts[:, 1], *self.POSE, W, H, FOV)
        err = np.abs(el - self._skyline_el_at(provider, az))
        self.assertLess(float(err.max()), 0.02, f"최대 각도 오차 {float(err.max()):.3f}°")

    def test_synthesized_ridge_lies_on_dem_skyline(self) -> None:
        from ai.dem_skyline_engine import DEMProvider

        provider = DEMProvider()
        pts = provider.synthesize_observed_skyline(*self.POSE, width=W, height=H, fov_h=FOV, noise_std_px=0.0)
        self.assertGreater(len(pts), 50)
        self._assert_on_skyline(provider, pts)

    def test_rendered_frame_ground_truth_lies_on_dem_skyline(self) -> None:
        from ai.dem_skyline_engine import DEMProvider
        from ai.ridge_detector import render_synthetic_cctv_frame

        provider = DEMProvider()
        _, gt = render_synthetic_cctv_frame(provider, *self.POSE, width=W, height=H, fov_h=FOV)
        self._assert_on_skyline(provider, gt)


class TestCalibrationUsesRotationModel(unittest.TestCase):
    """영점 보정이 정식 모델로 만든 능선에서 자세를 정확히 복원해야 함"""

    TRUE = (99.2, 2.0, 2.0)

    def test_zero_point_calibration_recovers_pose(self) -> None:
        from ai.dem_skyline_engine import DEMProvider

        provider = DEMProvider()
        ridge = provider.synthesize_observed_skyline(*self.TRUE, width=W, height=H, fov_h=FOV, noise_std_px=0.0)
        res = provider.calibrate_ptz_zero_point(
            init_pan=self.TRUE[0] - 1.0, init_tilt=self.TRUE[1] - 1.0, ridge_pts=ridge, width=W, height=H, fov_h=FOV
        )
        self.assertAlmostEqual(res["pan"], self.TRUE[0], delta=0.1)
        self.assertAlmostEqual(res["tilt"], self.TRUE[1], delta=0.1)
        self.assertAlmostEqual(res["roll"], self.TRUE[2], delta=0.2)
        self.assertLess(res["rms_deg"], 0.05)

    def test_zero_point_calibration_is_fast_enough(self) -> None:
        import time

        from ai.dem_skyline_engine import DEMProvider

        provider = DEMProvider()
        ridge = provider.synthesize_observed_skyline(*self.TRUE, width=W, height=H, fov_h=FOV, noise_std_px=0.0)
        t0 = time.perf_counter()
        provider.calibrate_ptz_zero_point(self.TRUE[0] - 1.0, self.TRUE[1] - 1.0, ridge, W, H, FOV)
        self.assertLess(time.perf_counter() - t0, 1.0)


if __name__ == "__main__":
    unittest.main()
