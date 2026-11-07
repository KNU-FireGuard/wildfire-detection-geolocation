"""
위치 오차 범위 error_range_m 테스트 (#59)

- 평평한 지형(해발 100m, 카메라 눈높이 115m)에서는 교차 거리가 15 / tan(내려다본 각)이라 손으로 검산 가능
  - 고도각 -2.0° → 약 430m, -1.5° → 약 573m, -2.5° → 약 344m
- 반경 = 고도각 ±σ로 다시 쏜 교차점까지의 거리, 옆 방향 D·tanσ, 대체 자세의 교차점까지 거리 중 최댓값 (10m 단위 올림)
"""
import math
import unittest

import numpy as np

from ai.dem_skyline_engine import GACHANG_CAM_LAT, GACHANG_CAM_LON

GROUND = 100.0
TOWER = 15.0
W, H = 1920, 1080
CENTER_BBOX = [940.0, 500.0, 980.0, 540.0]  # 아래 중앙 = 화면 중심 → 광선 고도각 = Tilt


class FlatProvider:
    cam_lat, cam_lon = GACHANG_CAM_LAT, GACHANG_CAM_LON
    tower_height_m = TOWER
    ground_alt = GROUND
    eye_alt = GROUND + TOWER

    def get_elevation(self, lat, lon):
        if np.ndim(lat):
            return np.full(np.shape(lat), GROUND)
        return GROUND


def flat_distance(el_deg: float) -> float:
    return TOWER / math.tan(math.radians(-el_deg))


class ErrorRangeCase(unittest.TestCase):
    def locate(self, tilt=-2.0, **kwargs):
        from ai.fire_location_estimator import FireLocationEstimator

        est = FireLocationEstimator(dem_provider=FlatProvider(), camera_configs=[])
        meta = {
            "camera": {"lat": GACHANG_CAM_LAT, "lon": GACHANG_CAM_LON, "tower_height": TOWER,
                       "fov_h": 50.0, "resolution_w": W, "resolution_h": H},
            "ptz": {"pan": 90.0, "tilt": tilt, "roll": 0.0},
            "bbox_format": "xyxy",
            "bbox_normalized": False,
        }
        return est.estimate_location(CENTER_BBOX, meta, use_skyline_calibration=False, **kwargs)


class TestErrorRange(ErrorRangeCase):
    def test_without_sigma_error_range_stays_null(self):
        res = self.locate()
        self.assertAlmostEqual(res["distance_m"], flat_distance(-2.0), delta=2.0)
        self.assertIsNone(res["location_estimation"]["error_range_m"])

    def test_grazing_ray_error_is_dominated_by_distance_direction(self):
        # -2° ± 0.5°: 앞쪽(-1.5°) 573m, 뒤쪽(-2.5°) 344m, 옆 방향 430·tan0.5° ≈ 4m → 반경은 573-430 ≈ 143m
        res = self.locate(angular_sigma_deg=0.5)
        expected = flat_distance(-1.5) - flat_distance(-2.0)
        err = res["location_estimation"]["error_range_m"]
        self.assertEqual(err % 10, 0)
        self.assertGreaterEqual(err, expected)
        self.assertLess(err, expected + 12.0)

    def test_larger_sigma_gives_larger_range(self):
        small = self.locate(angular_sigma_deg=0.25)["location_estimation"]["error_range_m"]
        large = self.locate(angular_sigma_deg=0.5)["location_estimation"]["error_range_m"]
        self.assertLess(small, large)

    def test_raised_ray_escaping_to_sky_extends_to_dem_edge(self):
        # -2° + 2.5° = +0.5°: 위로 향해 지형과 만나지 않음 → 능선 너머 DEM 끝(5km)까지 가능
        res = self.locate(angular_sigma_deg=2.5)
        err = res["location_estimation"]["error_range_m"]
        self.assertGreaterEqual(err, 5000.0 - res["distance_m"])
        self.assertLessEqual(err, 5000.0 - res["distance_m"] + 10.0)

    def test_alternative_view_is_included(self):
        # 화각을 바꿔 구한 다른 자세(Tilt -1.5°)의 교차점까지 원에 포함, σ=0이면 그것만으로 결정
        alt = {"pan": 90.0, "tilt": -1.5, "roll": 0.0, "fov_h": 50.0}
        res = self.locate(angular_sigma_deg=0.0, alt_views=[alt])
        expected = flat_distance(-1.5) - flat_distance(-2.0)
        err = res["location_estimation"]["error_range_m"]
        self.assertGreaterEqual(err, expected)
        self.assertLess(err, expected + 12.0)

    def test_lateral_error_when_terrain_is_steep(self):
        # 옆 방향 항: 거리 × tanσ (지형이 가파르면 앞뒤 변화보다 커질 수 있음), 평지에서도 하한으로 성립
        res = self.locate(angular_sigma_deg=0.5)
        self.assertGreaterEqual(res["location_estimation"]["error_range_m"],
                                res["distance_m"] * math.tan(math.radians(0.5)))


if __name__ == "__main__":
    unittest.main()
