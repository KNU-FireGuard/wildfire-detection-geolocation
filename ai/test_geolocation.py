from __future__ import annotations

import math
import shutil
import tempfile
import unittest
from pathlib import Path
import numpy as np

from ai.dem_skyline_engine import (
    DEMProvider,
    GACHANG_CAM_LAT,
    GACHANG_CAM_LON,
    build_and_cache_dem,
    build_and_cache_gachang_dem,
    fetch_terrarium_dem_grid,
    haversine_distance,
)
from ai.fire_location_estimator import FireLocationEstimator
from ai.ridge_detector import SkylineExtractor, render_synthetic_cctv_frame


class TestGeolocationEngine(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.mkdtemp()
        self.addCleanup(lambda: shutil.rmtree(self.temp_dir, ignore_errors=True))

    def test_cache_validation_and_dynamic_path(self) -> None:
        """P1: 캐시 좌표 불일치 시 기존 캐시 재사용 거부, 원본 보호 및 동적 파일명 분리 검증"""
        temp_cache = Path(self.temp_dir) / "test_gachang.npz"
        grid_size = 21
        lats = np.linspace(GACHANG_CAM_LAT - 0.01, GACHANG_CAM_LAT + 0.01, grid_size)
        lons = np.linspace(GACHANG_CAM_LON - 0.01, GACHANG_CAM_LON + 0.01, grid_size)
        elev_gachang = np.full((grid_size, grid_size), 200.0, dtype=np.float32)

        # 1. 임시 가창면 캐시 파일(고도 200m) 생성
        np.savez_compressed(
            temp_cache,
            lats=lats,
            lons=lons,
            elevation=elev_gachang,
            center=np.array([GACHANG_CAM_LAT, GACHANG_CAM_LON], dtype=np.float64),
            radius_m=np.array(1000.0, dtype=np.float64),
        )
        self.assertTrue(temp_cache.exists())

        # 2. 동일 좌표 요청 시 캐시(200m) 정상 재사용 확인
        data_hit = build_and_cache_gachang_dem(
            center_lat=GACHANG_CAM_LAT,
            center_lon=GACHANG_CAM_LON,
            radius_m=1000.0,
            grid_size=grid_size,
            npz_path=temp_cache,
            force_rebuild=False,
        )
        self.assertEqual(float(data_hit["elevation"][0, 0]), 200.0)
        self.assertEqual(Path(data_hit["npz_path"]), temp_cache)

        # 3. 다른 좌표(약 7km 떨어진 곳) 요청하되 npz_path에 기존 가창면 캐시(temp_cache)를 전달!
        #    기존 캐시(200m) 재사용을 거부하고 새 고도(500m)로 동적 경로에 생성하는지 검증
        diff_lat = GACHANG_CAM_LAT + 0.05
        diff_lon = GACHANG_CAM_LON + 0.05
        expected_dyn_path = Path(self.temp_dir) / f"dem_{diff_lat:.4f}_{diff_lon:.4f}_1000m.npz"

        # 네트워크 없이 재현되도록 고도 소스 주입: 앵커 500m, 고해상도 격자 소스는 오프라인(None)
        data_diff = build_and_cache_gachang_dem(
            center_lat=diff_lat,
            center_lon=diff_lon,
            radius_m=1000.0,
            grid_size=grid_size,
            npz_path=temp_cache,
            force_rebuild=False,
            anchor_source=lambda lats, lons: np.full(len(lats), 500.0, dtype=np.float32),
            grid_source=lambda *args, **kwargs: None,
        )

        # (a) 반환된 데이터가 가창면 캐시(200m)가 아니라 새로 빌드된 타 지역 고도(500m)여야 함
        self.assertAlmostEqual(float(data_diff["elevation"][10, 10]), 500.0, places=3)
        dist = haversine_distance(diff_lat, diff_lon, float(data_diff["center"][0]), float(data_diff["center"][1]))
        self.assertLessEqual(dist, 10.0)

        # (b) 동적 파일명으로 분리 저장되었고, 기존 temp_cache(200m)는 덮어쓰이지 않고 보존되었는지 확인
        self.assertEqual(Path(data_diff["npz_path"]), expected_dyn_path)
        self.assertTrue(expected_dyn_path.exists())
        with np.load(temp_cache) as orig_check:
            self.assertEqual(float(orig_check["elevation"][0, 0]), 200.0)

    def test_injected_elevation_sources_are_used_without_patching(self) -> None:
        """고도 소스를 인자로 주입하면 네트워크·mock 감지 없이 그 값으로 격자를 생성"""
        out = Path(self.temp_dir) / "injected.npz"
        calls = {"grid": 0}

        def fake_grid(lat_mesh, lon_mesh, **_kwargs):
            calls["grid"] += 1
            return np.full(np.shape(lat_mesh), 123.0, dtype=np.float32)

        data = build_and_cache_dem(
            center_lat=GACHANG_CAM_LAT + 0.07,
            center_lon=GACHANG_CAM_LON + 0.07,
            radius_m=1000.0,
            grid_size=21,
            npz_path=out,
            anchor_source=lambda lats, lons: np.full(len(lats), 500.0, dtype=np.float32),
            grid_source=fake_grid,
        )
        self.assertGreaterEqual(calls["grid"], 1)
        np.testing.assert_allclose(data["elevation"], 123.0)

    def test_dem_cache_records_source_and_upgrades_coarse_grid(self) -> None:
        """오프라인 보간 격자는 출처를 기록하고, 고해상도 소스가 가능해지면 다시 만들며, 고해상도 캐시는 재사용"""
        out = Path(self.temp_dir) / "source.npz"
        kwargs = dict(
            center_lat=GACHANG_CAM_LAT + 0.07,
            center_lon=GACHANG_CAM_LON + 0.07,
            radius_m=1000.0,
            grid_size=21,
            npz_path=out,
            anchor_source=lambda lats, lons: np.full(len(lats), 500.0, dtype=np.float32),
        )

        # 1. 고해상도 소스 없음(오프라인) -> 앵커 보간 격자, 출처 기록
        coarse = build_and_cache_dem(grid_source=lambda *a, **k: None, **kwargs)
        self.assertEqual(str(coarse["source"]), "open_meteo_anchor_interp")
        np.testing.assert_allclose(coarse["elevation"], 500.0)

        # 2. 같은 요청인데 고해상도 소스가 가능해짐 -> 거친 캐시를 버리고 다시 만듦
        fine = build_and_cache_dem(
            grid_source=lambda lat_m, lon_m, **k: np.full(np.shape(lat_m), 123.0, dtype=np.float32), **kwargs
        )
        self.assertEqual(str(fine["source"]), "terrarium")
        np.testing.assert_allclose(fine["elevation"], 123.0)

        # 3. 고해상도 캐시는 재사용: 격자 소스를 다시 호출하지 않음
        def must_not_call(*_a, **_k):
            raise AssertionError("고해상도 캐시가 있는데 격자 소스를 다시 호출함")

        reused = build_and_cache_dem(grid_source=must_not_call, **kwargs)
        self.assertEqual(str(reused["source"]), "terrarium")
        np.testing.assert_allclose(reused["elevation"], 123.0)

    def test_provider_updates_on_tower_height_change(self) -> None:
        """철탑 높이(tower_height) 변경 시 DEMProvider 갱신 검증"""
        estimator = FireLocationEstimator()
        cam_meta1 = {
            "camera": {
                "lat": GACHANG_CAM_LAT,
                "lon": GACHANG_CAM_LON,
                "tower_height": 15.0,
                "fov_h": 60.0,
            },
            "ptz": {"pan": 339.0, "tilt": 3.0, "roll": 0.0},
        }
        prov1 = estimator._get_provider(cam_meta1)
        self.assertAlmostEqual(prov1.tower_height_m, 15.0)

        # 철탑 높이를 30.0m로 변경한 메타데이터
        cam_meta2 = {
            "camera": {
                "lat": GACHANG_CAM_LAT,
                "lon": GACHANG_CAM_LON,
                "tower_height": 30.0,
                "fov_h": 60.0,
            },
            "ptz": {"pan": 339.0, "tilt": 3.0, "roll": 0.0},
        }
        prov2 = estimator._get_provider(cam_meta2)
        self.assertAlmostEqual(prov2.tower_height_m, 30.0)
        self.assertNotEqual(id(prov1), id(prov2))

    def test_no_intersection_handling(self) -> None:
        """P1: 광선이 허공을 향하거나 지형과 만나지 않을 때 NO_INTERSECTION 반환 검증"""
        estimator = FireLocationEstimator()
        # 하늘을 향하는 상향 광선 (Tilt = +45도)
        sky_meta = {
            "camera": {
                "lat": GACHANG_CAM_LAT,
                "lon": GACHANG_CAM_LON,
                "tower_height": 15.0,
                "fov_h": 60.0,
                "near_m": 30.0,
                "max_range_m": 5000.0,
            },
            "ptz": {"pan": 0.0, "tilt": 45.0, "roll": 0.0},
        }
        center_bbox = [0.4, 0.4, 0.6, 0.6]

        # 1. 3D DEM 모드에서 허공 발사 시
        res_dem = estimator.estimate_location(
            center_bbox, sky_meta, terrain_mode="3d_dem", use_skyline_calibration=False
        )
        self.assertFalse(res_dem["intersected"])
        self.assertEqual(res_dem["status"], "NO_INTERSECTION")
        self.assertIsNone(res_dem["lat"])
        self.assertIsNone(res_dem["lon"])
        self.assertIsNone(res_dem["distance_m"])

        # 2. 평면 지구 모드에서 상향 광선 발사 시
        res_flat = estimator.estimate_location(
            center_bbox, sky_meta, terrain_mode="flat_earth", use_skyline_calibration=False
        )
        self.assertFalse(res_flat["intersected"])
        self.assertEqual(res_flat["status"], "NO_INTERSECTION")
        self.assertIsNone(res_flat["lat"])
        self.assertIsNone(res_flat["lon"])

    def test_successful_intersection_status(self) -> None:
        """정상 지형 교차 시 intersected=True 및 status=OK 검증"""
        estimator = FireLocationEstimator()
        cam_meta = {
            "camera": {
                "lat": GACHANG_CAM_LAT,
                "lon": GACHANG_CAM_LON,
                "tower_height": 15.0,
                "fov_h": 60.0,
                "near_m": 30.0,
                "max_range_m": 5000.0,
            },
            "ptz": {"pan": 339.0, "tilt": 3.0, "roll": 0.0},
        }
        # 오리 416-3 방면 산비탈 바운딩 박스
        bbox = [0.465, 0.055, 0.525, 0.148]
        res = estimator.estimate_location(
            bbox, cam_meta, target_mode="bottom_center", terrain_mode="3d_dem", use_skyline_calibration=False
        )
        self.assertTrue(res["intersected"])
        self.assertEqual(res["status"], "OK")
        self.assertIsNotNone(res["lat"])
        self.assertIsNotNone(res["lon"])
        self.assertGreater(res["distance_m"], 0.0)

    def test_xywh_format_equivalence(self) -> None:
        """YOLO xywh 포맷 [xc, yc, w, h]과 xyxy 포맷 [xmin, ymin, xmax, ymax]의 동일성 검증"""
        estimator = FireLocationEstimator()

        # 1. 픽셀 좌표 기준 동일성 검증
        bbox_xyxy_px = [890.0, 60.0, 1010.0, 160.0]
        bbox_xywh_px = [950.0, 110.0, 120.0, 100.0]

        fx_xyxy, fy_xyxy = estimator.resolve_target_pixel(bbox_xyxy_px, bbox_format="xyxy")
        fx_xywh, fy_xywh = estimator.resolve_target_pixel(bbox_xywh_px, bbox_format="xywh")

        self.assertAlmostEqual(fx_xyxy, fx_xywh, places=4)
        self.assertAlmostEqual(fy_xyxy, fy_xywh, places=4)

        # 2. 정규화 좌표(0~1) 기준 동일성 검증
        bbox_xyxy_norm = [0.465, 0.055, 0.525, 0.148]
        bbox_xywh_norm = [0.495, 0.1015, 0.060, 0.093]

        fnx_xyxy, fny_xyxy = estimator.resolve_target_pixel(bbox_xyxy_norm, bbox_format="xyxy")
        fnx_xywh, fny_xywh = estimator.resolve_target_pixel(bbox_xywh_norm, bbox_format="xywh")

        self.assertAlmostEqual(fnx_xyxy, fnx_xywh, places=2)
        self.assertAlmostEqual(fny_xyxy, fny_xywh, places=2)

        # 3. estimate_location 파이프라인 엔드투엔드 동일성 검증
        cam_meta = {
            "camera": {
                "lat": GACHANG_CAM_LAT,
                "lon": GACHANG_CAM_LON,
                "tower_height": 15.0,
                "fov_h": 60.0,
                "near_m": 30.0,
                "max_range_m": 5000.0,
            },
            "ptz": {"pan": 339.0, "tilt": 3.0, "roll": 0.0},
        }

        res_xyxy = estimator.estimate_location(
            bbox_xyxy_norm, cam_meta, bbox_format="xyxy", use_skyline_calibration=False
        )
        res_xywh = estimator.estimate_location(
            bbox_xywh_norm, cam_meta, bbox_format="xywh", use_skyline_calibration=False
        )

        self.assertTrue(res_xyxy["intersected"])
        self.assertTrue(res_xywh["intersected"])
        self.assertAlmostEqual(res_xyxy["lat"], res_xywh["lat"], places=5)
        self.assertAlmostEqual(res_xyxy["lon"], res_xywh["lon"], places=5)
        self.assertAlmostEqual(res_xyxy["distance_m"], res_xywh["distance_m"], places=2)

    # 실제 가창오리 P339/T03 프리셋의 실측 자세 (위성지도 랜드마크·능선 공동 보정, 라벨 + 약 120°)
    P339_MEASURED_PAN = 99.2
    P339_MEASURED_TILT = 1.3

    def test_ridge_detector_smoke_masking_and_channel_invariance(self) -> None:
        """Issue #51: 역광 하늘, 좌측 상단 OSD, 연기 기둥 마스킹 및 RGB/BGR 불변성 검증 (실측 P339 자세)"""
        provider = DEMProvider()
        extractor = SkylineExtractor()
        smoke_bbox_px = [890.0, 40.0, 1010.0, 250.0]

        frame_rgb, gt_ridge = render_synthetic_cctv_frame(
            provider=provider,
            true_pan=self.P339_MEASURED_PAN,
            true_tilt=self.P339_MEASURED_TILT,
            true_roll=0.6,
            backlit_sky=True,
            add_osd=True,
            add_foreground_buildings=True,
            smoke_bbox_px=smoke_bbox_px,
            channel_order="RGB",
        )
        frame_bgr = frame_rgb[:, :, ::-1]

        res_rgb = extractor.extract(frame_rgb, smoke_x_range=(890.0, 1010.0))
        res_bgr = extractor.extract(frame_bgr, smoke_x_range=(890.0, 1010.0))

        self.assertTrue(res_rgb["is_valid"])
        self.assertTrue(res_bgr["is_valid"])

        pts_rgb = res_rgb["ridge_pts"]
        pts_bgr = res_bgr["ridge_pts"]
        np.testing.assert_allclose(pts_rgb, pts_bgr, atol=1e-4)

        # (1) 연기 바운딩 박스 가로 구간(890~1010px)이 능선 좌표에서 정상 제외되었는지 검증
        in_smoke = (pts_rgb[:, 0] >= 890.0) & (pts_rgb[:, 0] <= 1010.0)
        self.assertEqual(int(np.sum(in_smoke)), 0)

        # (2) 실제 DEM 능선 대비 픽셀 오차(RMSE) < 2.0px 검증
        gt_interp_y = np.interp(pts_rgb[:, 0], gt_ridge[:, 0], gt_ridge[:, 1])
        rmse_px = float(np.sqrt(np.mean((pts_rgb[:, 1] - gt_interp_y) ** 2)))
        self.assertLess(rmse_px, 2.0)

    def test_blind_ptz_360_recovery_with_roll(self) -> None:
        """Issue #51: PTZ 미제공(ptz=None) 및 카메라 Roll(0.8°) 상태에서 360° Blind 역산 및 발화점 위치 추정 검증"""
        estimator = FireLocationEstimator()
        provider = estimator._get_provider(GACHANG_CAM_LAT, GACHANG_CAM_LON, 15.0)

        # 정규화 바운딩 박스(0~1)와 연기 기둥이 포함된 합성 프레임 생성 (실측 P339 자세, 능선 아래 지면의 연기)
        bbox_norm = [0.5208, 0.5926, 0.5625, 0.6852]
        x0_px, y0_px, x1_px, y1_px = estimator.resolve_bbox_pixel_bounds(bbox_norm, 1920, 1080)
        frame, _ = render_synthetic_cctv_frame(
            provider=provider,
            true_pan=self.P339_MEASURED_PAN,
            true_tilt=self.P339_MEASURED_TILT,
            true_roll=0.8,
            backlit_sky=True,
            add_osd=True,
            add_foreground_buildings=True,
            smoke_bbox_px=[x0_px, y0_px, x1_px, y1_px],
        )

        # ptz 필드를 아예 생략(ptz=None)하고 frame만 전달
        blind_meta = {
            "camera": {
                "lat": GACHANG_CAM_LAT,
                "lon": GACHANG_CAM_LON,
                "tower_height": 15.0,
                "fov_h": 60.0,
                "resolution_w": 1920,
                "resolution_h": 1080,
                "near_m": 30.0,
                "max_range_m": 5000.0,
            },
            "frame": frame,
        }
        res = estimator.estimate_location(bbox_norm, blind_meta, use_skyline_calibration=True)

        self.assertTrue(res["intersected"])
        self.assertEqual(res["status"], "OK")
        cal = res["calibration"]
        self.assertTrue(cal["calibrated"])
        self.assertEqual(cal["mode"], "blind_360")
        self.assertGreaterEqual(cal["ncc"], 0.90)
        self.assertAlmostEqual(cal["pan"], self.P339_MEASURED_PAN, delta=0.25)
        self.assertAlmostEqual(cal["tilt"], self.P339_MEASURED_TILT, delta=0.25)
        self.assertAlmostEqual(cal["roll"], 0.8, delta=0.35)

        # 같은 bbox를 실제 자세(PTZ 제공)로 추정한 위치와 25m 이내로 일치하는지 확인
        # (필지 정답 좌표는 "라벨 = 진북 방위" 가정에서 나온 값이라 사용하지 않음)
        known_meta = {
            "camera": dict(blind_meta["camera"]),
            "ptz": {"pan": self.P339_MEASURED_PAN, "tilt": self.P339_MEASURED_TILT, "roll": 0.8},
        }
        ref = estimator.estimate_location(bbox_norm, known_meta, use_skyline_calibration=False)
        self.assertTrue(ref["intersected"])
        err_m = haversine_distance(ref["lat"], ref["lon"], res["lat"], res["lon"])
        self.assertLessEqual(err_m, 25.0)

    def test_blind_ptz_failsafe_on_fog_or_featureless_frame(self) -> None:
        """Issue #51: 안개/야간 프레임 또는 평탄한 직선 능선에서 ptz=None 역산 시 CALIBRATION_FAILED 안전 반환 검증"""
        estimator = FireLocationEstimator()
        bbox = [0.45, 0.30, 0.55, 0.50]

        # 1. 짙은 안개/야간으로 능선 대비가 없는 프레임
        fog_frame = np.full((1080, 1920, 3), 128, dtype=np.uint8)
        fog_meta = {
            "camera": {
                "lat": GACHANG_CAM_LAT,
                "lon": GACHANG_CAM_LON,
                "tower_height": 15.0,
                "fov_h": 60.0,
            },
            "frame": fog_frame,
        }
        res_fog = estimator.estimate_location(bbox, fog_meta)
        self.assertFalse(res_fog["intersected"])
        self.assertEqual(res_fog["status"], "CALIBRATION_FAILED")
        self.assertIsNone(res_fog["lat"])
        self.assertIsNone(res_fog["lon"])
        self.assertIsNone(res_fog["location_estimation"])

        # 2. 기복이 전혀 없는 수평 직선(도로 연석/건물 지붕, std < 0.35°)이 입력된 경우
        flat_xs = np.arange(100, 1820, 20, dtype=np.float64)
        flat_ys = np.full_like(flat_xs, 540.0)
        flat_ridge = np.column_stack([flat_xs, flat_ys])
        flat_meta = {
            "camera": {
                "lat": GACHANG_CAM_LAT,
                "lon": GACHANG_CAM_LON,
                "tower_height": 15.0,
                "fov_h": 60.0,
            },
            "ridge_pts": flat_ridge,
        }
        res_flat = estimator.estimate_location(bbox, flat_meta)
        self.assertFalse(res_flat["intersected"])
        self.assertEqual(res_flat["status"], "CALIBRATION_FAILED")
        self.assertIsNone(res_flat["lat"])
        self.assertIsNone(res_flat["location_estimation"])

    @staticmethod
    def _gachang_mesh() -> tuple[np.ndarray, np.ndarray]:
        lats = np.linspace(GACHANG_CAM_LAT - 0.005, GACHANG_CAM_LAT + 0.005, 11)
        lons = np.linspace(GACHANG_CAM_LON - 0.005, GACHANG_CAM_LON + 0.005, 11)
        lon_m, lat_m = np.meshgrid(lons, lats)
        return lat_m, lon_m

    def test_terrarium_cache_only_mode_does_not_download(self) -> None:
        """allow_download=False이고 캐시가 비어 있으면 네트워크 없이 None 반환, 파일도 만들지 않음"""
        lat_m, lon_m = self._gachang_mesh()
        empty_cache = Path(self.temp_dir) / "empty_tiles"
        grid = fetch_terrarium_dem_grid(lat_m, lon_m, zoom=12, cache_dir=empty_cache, allow_download=False)
        self.assertIsNone(grid)
        self.assertFalse(any(empty_cache.glob("*.png")) if empty_cache.exists() else False)

    def test_terrarium_loader_from_local_cache(self) -> None:
        """로컬 캐시된 AWS Terrarium 30m 타일로 고해상도 표고 격자 추출 (캐시가 없는 환경에서는 건너뜀)"""
        lat_m, lon_m = self._gachang_mesh()
        terr_grid = fetch_terrarium_dem_grid(lat_m, lon_m, zoom=12, allow_download=False)
        if terr_grid is None:
            self.skipTest("로컬 DEM 타일 캐시(ai/.dem_cache/) 없음, 네트워크 다운로드 테스트는 생략")
        self.assertEqual(terr_grid.shape, (11, 11))
        self.assertGreater(float(terr_grid.max() - terr_grid.min()), 20.0)

    def test_dem_builder_and_backend_api_contract(self) -> None:
        """Issue #51: build_and_cache_dem 범용 함수 및 백엔드 API 입출력 포맷 검증 (저장소의 가창 DEM 캐시 사용)"""
        # 1. build_and_cache_dem 범용 함수 동작 확인
        dem_data = build_and_cache_dem(center_lat=GACHANG_CAM_LAT, center_lon=GACHANG_CAM_LON)
        self.assertEqual(dem_data["elevation"].shape, (201, 201))

        # 2. 백엔드 POST /api/detections 규격 bbox 딕셔너리 입력 및 location_estimation 출력 확인
        estimator = FireLocationEstimator()
        api_bbox = {"x1": 893, "y1": 59, "x2": 1008, "y2": 160}
        meta = {
            "camera": {
                "lat": GACHANG_CAM_LAT,
                "lon": GACHANG_CAM_LON,
                "tower_height": 15.0,
                "fov_h": 60.0,
                "near_m": 30.0,
            },
            "ptz": {"pan": 339.0, "tilt": 3.0, "roll": 0.0},
        }
        res = estimator.estimate_location(api_bbox, meta, use_skyline_calibration=False)
        self.assertTrue(res["intersected"])
        self.assertIsNotNone(res["location_estimation"])
        loc_est = res["location_estimation"]
        self.assertIn("latitude", loc_est)
        self.assertIn("longitude", loc_est)
        self.assertIn("error_range_m", loc_est)
        self.assertAlmostEqual(loc_est["latitude"], res["lat"], places=5)
        self.assertAlmostEqual(loc_est["longitude"], res["lon"], places=5)


class TestBBoxAdapter(unittest.TestCase):
    """bbox 입력 계약: 명시적 포맷·정규화 지정, 모호하거나 잘못된 입력은 조용히 보정하지 않고 실패"""

    XYXY_NORM = [0.465, 0.055, 0.525, 0.148]
    # 같은 상자를 [cx, cy, 높이, 너비] 순서로 표현 (cx=0.495, cy=0.1015, h=0.093, w=0.060)
    CXCYHW_NORM = [0.495, 0.1015, 0.093, 0.060]

    def test_cxcyhw_normalized_matches_xyxy(self) -> None:
        """[cx, cy, 높이, 너비] 정규화 입력이 동일 상자의 xyxy와 같은 픽셀 경계로 변환되는지 검증"""
        expected = FireLocationEstimator.resolve_bbox_pixel_bounds(
            self.XYXY_NORM, 1920, 1080, bbox_format="xyxy"
        )
        actual = FireLocationEstimator.resolve_bbox_pixel_bounds(
            self.CXCYHW_NORM, 1920, 1080, bbox_format="cxcyhw", normalized=True
        )
        for e, a in zip(expected, actual):
            self.assertAlmostEqual(e, a, delta=0.5)

    def test_cxcyhw_and_xywh_are_not_interchangeable(self) -> None:
        """높이·너비 순서가 다른 두 포맷을 혼동하면 하단점(y_max)이 크게 달라져야 함 (순서 오류 탐지용 음성 테스트)"""
        as_hw = FireLocationEstimator.resolve_bbox_pixel_bounds(
            self.CXCYHW_NORM, 1920, 1080, bbox_format="cxcyhw", normalized=True
        )
        as_wh = FireLocationEstimator.resolve_bbox_pixel_bounds(
            self.CXCYHW_NORM, 1920, 1080, bbox_format="xywh", normalized=True
        )
        self.assertGreater(abs(as_hw[3] - as_wh[3]), 10.0)

    def test_unknown_format_is_rejected(self) -> None:
        """알 수 없는 포맷이 조용히 xyxy로 처리되지 않고 ValueError를 내는지 검증"""
        with self.assertRaises(ValueError):
            FireLocationEstimator.resolve_bbox_pixel_bounds(
                self.XYXY_NORM, 1920, 1080, bbox_format="unknown"
            )

    def test_normalized_flag_rejects_pixel_values(self) -> None:
        """normalized=True인데 값이 0~1 범위를 벗어나면 ValueError"""
        with self.assertRaises(ValueError):
            FireLocationEstimator.resolve_bbox_pixel_bounds(
                [890.0, 60.0, 1010.0, 160.0], 1920, 1080, bbox_format="xyxy", normalized=True
            )

    def test_degenerate_or_out_of_frame_bbox_is_rejected(self) -> None:
        """상자가 뒤집혔거나(x_min>=x_max) 프레임 밖이면 ValueError"""
        with self.assertRaises(ValueError):
            FireLocationEstimator.resolve_bbox_pixel_bounds(
                [1010.0, 60.0, 890.0, 160.0], 1920, 1080, bbox_format="xyxy", normalized=False
            )
        with self.assertRaises(ValueError):
            FireLocationEstimator.resolve_bbox_pixel_bounds(
                [1800.0, 60.0, 2400.0, 160.0], 1920, 1080, bbox_format="xyxy", normalized=False
            )

    def test_invalid_bbox_returns_failsafe_result(self) -> None:
        """estimate_location은 잘못된 bbox에서 예외 대신 위치 없는 INVALID_BBOX 결과를 반환"""
        estimator = FireLocationEstimator()
        meta = {
            "camera": {
                "lat": GACHANG_CAM_LAT,
                "lon": GACHANG_CAM_LON,
                "tower_height": 15.0,
                "fov_h": 60.0,
            },
            "ptz": {"pan": 339.0, "tilt": 3.0, "roll": 0.0},
        }
        res = estimator.estimate_location(
            [1010.0, 60.0, 890.0, 160.0], meta, use_skyline_calibration=False, bbox_normalized=False
        )
        self.assertFalse(res["intersected"])
        self.assertEqual(res["status"], "INVALID_BBOX")
        self.assertIsNone(res["lat"])
        self.assertIsNone(res["location_estimation"])

    def test_frame_size_overrides_default_resolution(self) -> None:
        """프레임이 주어지면 camera 메타 기본 해상도(1920x1080)가 아니라 실제 프레임 크기로 픽셀 bbox를 해석"""
        estimator = FireLocationEstimator()
        cam = {
            "lat": GACHANG_CAM_LAT,
            "lon": GACHANG_CAM_LON,
            "tower_height": 15.0,
            "fov_h": 60.0,
            "near_m": 30.0,
            "max_range_m": 5000.0,
        }
        ptz = {"pan": 339.0, "tilt": 3.0, "roll": 0.0}

        # 기준: 1920x1080 프레임의 픽셀 bbox
        ref = estimator.estimate_location(
            [892.5, 60.0, 1008.0, 160.5],
            {"camera": dict(cam), "ptz": ptz},
            use_skyline_calibration=False,
            bbox_normalized=False,
        )
        # 동일 장면을 1280x720으로 본 프레임 (모든 좌표 1/1.5배), 해상도 메타는 생략
        small_frame = np.zeros((720, 1280, 3), dtype=np.uint8)
        small = estimator.estimate_location(
            [595.0, 40.0, 672.0, 107.0],
            {"camera": dict(cam), "ptz": ptz, "frame": small_frame},
            use_skyline_calibration=False,
            bbox_normalized=False,
        )
        self.assertTrue(ref["intersected"])
        self.assertTrue(small["intersected"])
        self.assertLess(haversine_distance(ref["lat"], ref["lon"], small["lat"], small["lon"]), 3.0)


class TestLocationEstimationContract(unittest.TestCase):
    """location_estimation 출력 계약: 근거 없는 오차 범위를 만들어내지 않음"""

    def test_error_range_is_none_until_modelled(self) -> None:
        """오차 범위 산출 모델이 없으므로 모든 지형 모드에서 error_range_m은 None이어야 함 (API 명세상 null 허용)"""
        estimator = FireLocationEstimator()
        meta = {
            "camera": {
                "lat": GACHANG_CAM_LAT,
                "lon": GACHANG_CAM_LON,
                "tower_height": 15.0,
                "fov_h": 60.0,
                "near_m": 30.0,
                "max_range_m": 5000.0,
            },
            "ptz": {"pan": 339.0, "tilt": 3.0, "roll": 0.0},
        }
        bbox = [892.5, 60.0, 1008.0, 160.5]
        res_dem = estimator.estimate_location(
            bbox, meta, terrain_mode="3d_dem", use_skyline_calibration=False, bbox_normalized=False
        )
        self.assertTrue(res_dem["intersected"])
        self.assertIsNotNone(res_dem["location_estimation"])
        self.assertIsNone(res_dem["location_estimation"]["error_range_m"])

        # 평면 지구 모드는 하향 광선이어야 교차하므로 tilt를 낮춘 별도 메타 사용
        flat_meta = {**meta, "ptz": {"pan": 339.0, "tilt": -10.0, "roll": 0.0}}
        res_flat = estimator.estimate_location(
            [0.45, 0.60, 0.55, 0.80], flat_meta, terrain_mode="flat_earth", use_skyline_calibration=False
        )
        self.assertTrue(res_flat["intersected"])
        self.assertIsNone(res_flat["location_estimation"]["error_range_m"])


class TestBlindPtzTiltRange(unittest.TestCase):
    """360° 역산의 물리적 Tilt 허용 범위 검사가 실제로 동작해야 함"""

    def test_tilt_outside_allowed_range_fails_instead_of_clipping(self) -> None:
        """실제 Tilt(1.3°)가 허용 최대값(0.5°)보다 크면 0.5°로 잘라 OK를 내지 않고 CALIBRATION_FAILED 반환"""
        provider = DEMProvider()
        ridge = provider.synthesize_observed_skyline(true_pan=99.2, true_tilt=1.3, true_roll=0.0, noise_std_px=0.0)
        res = provider.estimate_blind_ptz(ridge, max_tilt_deg=0.5)
        self.assertEqual(res["status"], "CALIBRATION_FAILED")
        self.assertFalse(res["calibrated"])

    def test_tilt_inside_allowed_range_is_recovered(self) -> None:
        """허용 범위 안의 Tilt는 그대로 복원 (범위 검사 수정이 정상 경우를 막지 않는지 확인)"""
        provider = DEMProvider()
        ridge = provider.synthesize_observed_skyline(true_pan=99.2, true_tilt=1.3, true_roll=0.0, noise_std_px=0.0)
        res = provider.estimate_blind_ptz(ridge)
        self.assertEqual(res["status"], "OK")
        self.assertAlmostEqual(res["tilt"], 1.3, delta=0.25)


class TestExperimentReportRows(unittest.TestCase):
    """실험 3 결과 표: 역산 실패도 크래시 없이 실제 상태대로 출력"""

    FAILED = {
        "intersected": False,
        "status": "CALIBRATION_FAILED",
        "lat": None,
        "lon": None,
        "calibration": {"pan": None, "tilt": None, "roll": None, "ncc": 0.0, "status": "CALIBRATION_FAILED"},
        "location_estimation": None,
    }
    OK = {
        "intersected": True,
        "status": "OK",
        "lat": 35.7938,
        "lon": 128.5899,
        "calibration": {"pan": 99.21, "tilt": 1.31, "roll": 0.79, "ncc": 0.97},
    }

    def test_blind_row_with_failed_calibration_does_not_crash(self) -> None:
        from ai.run_paper_experiment import format_blind_row

        row = format_blind_row("사례 1", (99.2, 1.3, 0.6), self.FAILED, (35.7938, 128.5899))
        self.assertIn("CALIBRATION_FAILED", row)
        self.assertNotIn("✅", row)

    def test_blind_row_with_success_shows_pose_and_error(self) -> None:
        from ai.run_paper_experiment import format_blind_row

        row = format_blind_row("사례 1", (99.2, 1.3, 0.6), self.OK, (35.7938, 128.5899))
        self.assertIn("✅", row)
        self.assertIn("99.21", row)
        self.assertIn("0.0 m", row)

    def test_failsafe_row_reports_actual_outcome(self) -> None:
        """안개 프레임 줄은 결과와 무관한 '오경보 0%' 고정 문구 대신 실제 차단 여부를 출력"""
        from ai.run_paper_experiment import format_failsafe_row

        blocked = format_failsafe_row(self.FAILED)
        self.assertIn("CALIBRATION_FAILED", blocked)
        self.assertNotIn("오경보 0%", blocked)
        leaked = format_failsafe_row(self.OK)
        self.assertIn("오경보", leaked)
        self.assertNotIn("🛡️", leaked)


class TestSkylineExtractorOSD(unittest.TestCase):
    """좌상단 OSD(카메라 이름·시각) 글씨 테두리를 산능선으로 오인하지 않아야 함"""

    @staticmethod
    def _frame_with_osd(ridge_left_y: float) -> np.ndarray:
        height, width = 1080, 1920
        yy = np.arange(height)[:, None]
        xx = np.arange(width)[None, :]
        ridge = ridge_left_y + (xx / width) * 200.0 + 25.0 * np.sin(xx / 90.0)
        lum = np.where(yy < ridge, 200.0, 55.0)
        img = np.repeat(lum[:, :, None], 3, axis=2)
        # 실제 가창오리 영상처럼 흰 글씨 + 검은 테두리 OSD (x 20~300, y 6~34)
        img[6:30, 20:300, :] = 250.0
        img[30:34, 20:300, :] = 15.0
        return img.astype(np.uint8)

    def test_osd_text_edge_is_not_taken_as_ridge(self) -> None:
        """실제 능선이 좌상단 가까이(y≈70) 있어도 OSD 글씨 아래 테두리(y≈30)를 능선으로 반환하지 않음"""
        res = SkylineExtractor().extract(self._frame_with_osd(ridge_left_y=70.0))
        self.assertTrue(res["is_valid"])
        pts = res["ridge_pts"]
        in_osd = (pts[:, 0] < 320.0) & (pts[:, 1] < 45.0)
        self.assertEqual(int(np.sum(in_osd)), 0)


if __name__ == "__main__":
    unittest.main()
