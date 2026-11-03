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
    build_and_cache_gachang_dem,
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
        from unittest.mock import patch

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

        mock_api_elev = np.full(100, 500.0, dtype=np.float32)
        with patch("ai.dem_skyline_engine.fetch_open_meteo_batch", return_value=mock_api_elev):
            data_diff = build_and_cache_gachang_dem(
                center_lat=diff_lat,
                center_lon=diff_lon,
                radius_m=1000.0,
                grid_size=grid_size,
                npz_path=temp_cache,
                force_rebuild=False,
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

    def test_ridge_detector_top_peak_and_smoke_masking(self) -> None:
        """Issue #51: 역광 하늘, 상단 산봉우리(y<100px), 좌측 상단 OSD, 연기 기둥 마스킹 및 RGB/BGR 불변성 검증"""
        provider = DEMProvider()
        extractor = SkylineExtractor()
        smoke_bbox_px = [890.0, 40.0, 1010.0, 250.0]

        frame_rgb, gt_ridge = render_synthetic_cctv_frame(
            provider=provider,
            true_pan=339.0,
            true_tilt=3.0,
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

        # (2) 상단 산봉우리(y < 100px)가 OSD 마스킹에 잘리지 않고 정상 보존되었는지 검증
        self.assertLess(float(pts_rgb[:, 1].min()), 100.0)

        # (3) 실제 DEM 능선 대비 픽셀 오차(RMSE) < 2.0px 검증
        gt_interp_y = np.interp(pts_rgb[:, 0], gt_ridge[:, 0], gt_ridge[:, 1])
        rmse_px = float(np.sqrt(np.mean((pts_rgb[:, 1] - gt_interp_y) ** 2)))
        self.assertLess(rmse_px, 2.0)


if __name__ == "__main__":
    unittest.main()
