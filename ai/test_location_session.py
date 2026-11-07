"""실행 단위 위치 추정 세션 (#60): 자세는 실행 시작 시 1회 결정, 탐지마다 bbox → 위경도"""
from __future__ import annotations

import math
import unittest

from ai.dem_skyline_engine import DEMProvider, dest_point, haversine_distance

TRUE_FOV = 50.0
TRUE_POSE = (99.2, 1.3, 0.8)
W, H = 1920, 1080


def config_entry(fixed_pose: bool = True, fov: float = TRUE_FOV, validation_max_error_deg: float | None = None) -> dict:
    entry = {"key": "syn-fixed", "name": "합성고정", "camera_id": None, "fov_h_deg": fov}
    if validation_max_error_deg is not None:
        entry["uncertainty"] = {"validation_max_error_deg": validation_max_error_deg}
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
            # #59: 자세 각도 오차로 산출한 반경(m), 10m 단위
            self.assertGreater(loc["error_range_m"], 0.0)
            self.assertEqual(loc["error_range_m"] % 10, 0)
            self.assertLess(haversine_distance(loc["latitude"], loc["longitude"], la, lo), 30.0)


class TestAngularSigma(LocationSessionCase):
    """오차 반경에 쓰는 자세 각도 오차 σ (#59): 측정값이 있으면 측정값, 없으면 게이트 허용 상한"""

    def _fixed(self, **cfg_kwargs):
        from ai.fire_location_estimator import FireLocationEstimator
        from ai.location_session import LocationSession

        est = FireLocationEstimator(dem_provider=self.provider, skyline_extractor=NoCalibrationExtractor(),
                                    camera_configs=[config_entry(**cfg_kwargs)])
        session = LocationSession(self.camera, estimator=est)
        return session, session.prepare(frame=None, frame_size=(W, H))

    def test_fixed_pose_uses_validation_landmark_error(self) -> None:
        _, status = self._fixed(validation_max_error_deg=1.16)
        self.assertEqual(status["angular_sigma_deg"], 1.16)
        self.assertEqual(status["sigma_source"], "validation_landmarks")

    def test_fixed_pose_without_validation_uses_gate_limit(self) -> None:
        _, status = self._fixed()
        self.assertEqual(status["angular_sigma_deg"], 1.5)
        self.assertEqual(status["sigma_source"], "gate_max_residual")

    def test_larger_sigma_gives_larger_range_for_same_detection(self) -> None:
        bbox, _ = self.ground_bbox(0.0, 1300.0)
        small, _ = self._fixed(validation_max_error_deg=0.3)
        large, _ = self._fixed(validation_max_error_deg=1.5)
        self.assertLess(small.locate(bbox)["error_range_m"], large.locate(bbox)["error_range_m"])


class TestDemUnavailable(LocationSessionCase):
    """DEM 캐시가 없고 다운로드도 실패하는 PC: 시작 시 1회만 시도하고 위치 추정을 끔"""

    def test_fixed_pose_session_is_not_ready_and_does_not_retry(self) -> None:
        from ai.fire_location_estimator import FireLocationEstimator
        from ai.location_session import LocationSession

        class OfflineEstimator(FireLocationEstimator):
            provider_calls = 0

            def _get_provider(self, *args, **kwargs):
                OfflineEstimator.provider_calls += 1
                raise RuntimeError("DEM 데이터를 다운로드할 수 없습니다.")

        est = OfflineEstimator(skyline_extractor=NoCalibrationExtractor(), camera_configs=[config_entry()])
        session = LocationSession(self.camera, estimator=est)
        status = session.prepare(frame=None, frame_size=(W, H))
        self.assertFalse(status["ready"])
        self.assertEqual(status["reason"], "DEM_UNAVAILABLE")
        bbox, _ = self.ground_bbox(0.0, 900.0)
        for _ in range(3):
            self.assertIsNone(session.locate(bbox))
        # 탐지마다 다운로드를 다시 시도하면 추론 스레드와 영상 전송이 멈춤
        self.assertEqual(OfflineEstimator.provider_calls, 1)


class CountingProvider:
    """DEMProvider를 감싸 360° 역산 호출 횟수를 셈"""

    def __init__(self, provider):
        self._p = provider
        self.blind_calls = 0

    def __getattr__(self, name):
        return getattr(self._p, name)

    def estimate_blind_ptz(self, *args, **kwargs):
        self.blind_calls += 1
        return self._p.estimate_blind_ptz(*args, **kwargs)


class TestBlindPoseOnce(LocationSessionCase):
    """고정 자세가 없는 카메라: 첫 프레임 능선으로 360° 역산 1회, 이후 탐지는 같은 자세 재사용"""

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        from ai.ridge_detector import render_synthetic_cctv_frame

        cls.frame, _ = render_synthetic_cctv_frame(cls.provider, *TRUE_POSE, fov_h=TRUE_FOV, add_osd=True)

    def _session(self, configs):
        from ai.fire_location_estimator import FireLocationEstimator
        from ai.location_session import LocationSession

        counter = CountingProvider(self.provider)
        est = FireLocationEstimator(dem_provider=counter, camera_configs=configs)
        return LocationSession(self.camera, estimator=est), counter

    def test_configured_fov_without_pose_estimates_pose_once(self) -> None:
        session, counter = self._session([config_entry(fixed_pose=False)])
        status = session.prepare(frame=self.frame, frame_size=(W, H))
        self.assertTrue(status["ready"], status)
        self.assertEqual(status["mode"], "blind_360_once")
        self.assertEqual(status["fov_h_deg"], TRUE_FOV)
        self.assertLess(abs((status["pan"] - TRUE_POSE[0] + 180.0) % 360.0 - 180.0), 1.0)
        for off, dist in ((-8.0, 900.0), (6.0, 1300.0)):
            bbox, (la, lo) = self.ground_bbox(off, dist)
            loc = session.locate(bbox)
            self.assertIsNotNone(loc)
            self.assertLess(haversine_distance(loc["latitude"], loc["longitude"], la, lo), 100.0)
        self.assertEqual(counter.blind_calls, 1)

    def test_unconfigured_camera_uses_default_fov_with_warning(self) -> None:
        session, _ = self._session([])
        status = session.prepare(frame=self.frame, frame_size=(W, H))
        self.assertEqual(status["fov_h_deg"], 60.0)
        self.assertIn("FOV_DEFAULT_USED", status["warnings"])

    def test_blind_sigma_is_the_ridge_residual(self) -> None:
        session, _ = self._session([config_entry(fixed_pose=False)])
        status = session.prepare(frame=self.frame, frame_size=(W, H))
        self.assertEqual(status["sigma_source"], "ridge_residual")
        self.assertGreater(status["angular_sigma_deg"], 0.0)
        self.assertLessEqual(status["angular_sigma_deg"], 1.5)  # 게이트 통과 자세의 잔차 상한
        self.assertEqual(status["alt_views"], [])  # 화각을 아는 카메라는 화각 대체 자세 없음

    def test_default_fov_also_solves_pose_at_plus_minus_10_percent(self) -> None:
        from ai.ridge_detector import render_synthetic_cctv_frame

        frame60, _ = render_synthetic_cctv_frame(self.provider, *TRUE_POSE, fov_h=60.0, add_osd=True)
        session, counter = self._session([])
        status = session.prepare(frame=frame60, frame_size=(W, H))
        self.assertTrue(status["ready"], status)
        # 기본 60°로 1회 + 54°·66°로 1회씩, 시작 시에만 (탐지마다 반복하지 않음)
        self.assertEqual(counter.blind_calls, 3)
        self.assertTrue(all(v["fov_h"] in (54.0, 66.0) for v in status["alt_views"]))
        bbox, _ = self.ground_bbox(0.0, 1300.0, fov=60.0)
        session.locate(bbox)
        self.assertEqual(counter.blind_calls, 3)


class RaisingEstimator:
    """시작 시 DEM 준비는 성공하고, 탐지별 위치 계산에서 예외가 나는 경우"""

    camera_configs = [config_entry()]

    def _get_provider(self, *args, **kwargs):
        return None

    def estimate_location(self, *args, **kwargs):
        raise RuntimeError("DEM 다운로드 실패")


class TestFailuresKeepNull(LocationSessionCase):
    """위치를 구할 수 없으면 예외 없이 None (탐지 전송·영상 스트림은 계속)"""

    def _estimator(self, configs):
        from ai.fire_location_estimator import FireLocationEstimator

        return FireLocationEstimator(dem_provider=self.provider, camera_configs=configs)

    def test_camera_without_coordinates_is_not_located(self) -> None:
        from ai.location_session import LocationSession

        session = LocationSession({**self.camera, "lat": None, "lon": None}, estimator=self._estimator([config_entry()]))
        status = session.prepare(frame=None, frame_size=(W, H))
        self.assertFalse(status["ready"])
        self.assertEqual(status["reason"], "NO_CAMERA_COORDINATES")
        self.assertIsNone(session.locate([900, 500, 950, 560]))

    def test_failed_blind_calibration_returns_none_for_every_detection(self) -> None:
        import numpy as np

        from ai.location_session import LocationSession

        flat = np.full((H, W, 3), 128, dtype=np.uint8)  # 능선이 없는 화면
        session = LocationSession(self.camera, estimator=self._estimator([config_entry(fixed_pose=False)]))
        status = session.prepare(frame=flat, frame_size=(W, H))
        self.assertFalse(status["ready"])
        self.assertEqual(status["reason"], "RIDGE_NOT_DETECTED")
        self.assertIsNone(session.locate([900, 500, 950, 560]))

    def test_estimation_error_returns_none(self) -> None:
        from ai.location_session import LocationSession

        session = LocationSession(self.camera, estimator=RaisingEstimator())
        session.prepare(frame=None, frame_size=(W, H))
        self.assertIsNone(session.locate([900, 500, 950, 560]))
        self.assertEqual(session.last_error, "RuntimeError: DEM 다운로드 실패")

    def test_ray_into_sky_returns_none(self) -> None:
        from ai.location_session import LocationSession

        session = LocationSession(self.camera, estimator=self._estimator([config_entry()]))
        session.prepare(frame=None, frame_size=(W, H))
        self.assertIsNone(session.locate([900, 0, 950, 5]))


if __name__ == "__main__":
    unittest.main()
