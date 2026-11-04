"""실행 단위 위치 추정 세션 (#60): 자세는 실행 시작 시 1회 결정, 탐지마다 bbox → 위경도"""
from __future__ import annotations

import math
import unittest

from ai.dem_skyline_engine import DEMProvider, dest_point, haversine_distance

TRUE_FOV = 50.0
TRUE_POSE = (99.2, 1.3, 0.8)
W, H = 1920, 1080


def config_entry(fixed_pose: bool = True, fov: float = TRUE_FOV) -> dict:
    entry = {"key": "syn-fixed", "name": "합성고정", "camera_id": None, "fov_h_deg": fov}
    if fixed_pose:
        entry["fixed_pose"] = {"pan": TRUE_POSE[0], "tilt": TRUE_POSE[1], "roll": TRUE_POSE[2]}
    return entry


class NoCalibrationExtractor:
    """고정 자세 카메라는 능선 추출을 하지 않아야 함"""

    def extract(self, *args, **kwargs):  # pragma: no cover - 호출되면 실패
        raise AssertionError("고정 자세 카메라에서 능선 추출이 호출됨")


class LocationSessionCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.provider = DEMProvider()
        cls.camera = {"id": 7, "name": "합성고정", "lat": cls.provider.cam_lat, "lon": cls.provider.cam_lon}

    def ground_bbox(self, bearing_off: float, dist_m: float, pose=TRUE_POSE, fov=TRUE_FOV):
        """정답 자세로 지면 점을 투영해 그 점이 bbox 아래 중앙이 되도록 만든 xyxy와 정답 위경도"""
        from ai.camera_model import direction_to_pixel

        az = (pose[0] + bearing_off) % 360.0
        la, lo = dest_point(self.provider.cam_lat, self.provider.cam_lon, az, dist_m)
        dz = float(self.provider.get_elevation(la, lo)) - self.provider.eye_alt
        x, y, _ = direction_to_pixel(az, math.degrees(math.atan2(dz, dist_m)), *pose, W, H, fov)
        return [float(x) - 20.0, float(y) - 40.0, float(x) + 20.0, float(y)], (la, lo)


class TestFixedPoseSession(LocationSessionCase):
    def _session(self):
        from ai.fire_location_estimator import FireLocationEstimator
        from ai.location_session import LocationSession

        est = FireLocationEstimator(dem_provider=self.provider, skyline_extractor=NoCalibrationExtractor(),
                                    camera_configs=[config_entry()])
        return LocationSession(self.camera, estimator=est)

    def test_pose_comes_from_config_without_frame(self) -> None:
        session = self._session()
        status = session.prepare(frame=None, frame_size=(W, H))
        self.assertTrue(status["ready"])
        self.assertEqual(status["mode"], "config_fixed_pose")
        self.assertEqual(status["fov_h_deg"], TRUE_FOV)
        self.assertEqual((status["pan"], status["tilt"], status["roll"]), TRUE_POSE)

    def test_detections_are_located_with_the_same_pose(self) -> None:
        session = self._session()
        session.prepare(frame=None, frame_size=(W, H))
        for off, dist in ((-8.0, 900.0), (6.0, 1300.0)):
            bbox, (la, lo) = self.ground_bbox(off, dist)
            loc = session.locate(bbox)
            self.assertIsNotNone(loc)
            self.assertEqual(set(loc), {"latitude", "longitude", "error_range_m"})
            self.assertIsNone(loc["error_range_m"])
            self.assertLess(haversine_distance(loc["latitude"], loc["longitude"], la, lo), 30.0)


if __name__ == "__main__":
    unittest.main()
