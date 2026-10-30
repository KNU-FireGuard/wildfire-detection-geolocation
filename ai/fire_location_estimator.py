from __future__ import annotations

import math

try:
    from ai.dem_skyline_calibrator import (
        DEM,
        K_REFRACTION,
        R_EARTH,
        SkylineCalibrator,
        dest_point,
    )
except ImportError:
    from dem_skyline_calibrator import (
        DEM,
        K_REFRACTION,
        R_EARTH,
        SkylineCalibrator,
        dest_point,
    )


class FireLocationEstimator:
    """
    Single-Track Precision Wildfire Geolocation Engine:
      Stage 1: DEM Skyline-based PTZ Self-Calibration (corrects mechanical dPan, dTilt, Roll)
      Stage 2: 3D Ray Marching + 10-step Binary Search on AWS Terrarium DEM with Earth Curvature
    """

    def __init__(self, dem: DEM | None = None, zoom: int = 12, dem_radius_m: float = 12000.0):
        self.dem = dem
        self.zoom = zoom
        self.dem_radius_m = dem_radius_m
        self._calibrator: SkylineCalibrator | None = (
            SkylineCalibrator(dem) if dem is not None else None
        )

    def _ensure_dem(self, cam_lat: float, cam_lon: float) -> DEM:
        if self.dem is None:
            self.dem = DEM(center=(cam_lat, cam_lon), radius_m=self.dem_radius_m, zoom=self.zoom)
            self._calibrator = SkylineCalibrator(self.dem)
        return self.dem

    @staticmethod
    def extract_fire_root_pixel(
        bbox: list[float] | tuple[float, float, float, float],
        bottom_inset_ratio: float = 0.05,
    ) -> tuple[float, float]:
        """
        Extract the lower-center ignition root pixel of a smoke/fire bounding box.
        Uses a small bottom inset (default 5% of box height above y_max) to target the smoke base.
        """
        x_min, y_min, x_max, y_max = bbox
        fire_x = (x_min + x_max) / 2.0
        height = max(0.0, y_max - y_min)
        fire_y = float(y_max) - height * bottom_inset_ratio
        return fire_x, fire_y

    def estimate_location(
        self,
        bbox: list[float] | tuple[float, float, float, float],
        metadata: dict,
        use_skyline_calibration: bool = True,
        bottom_inset_ratio: float = 0.05,
    ) -> dict:
        """
        Estimate the 3D terrain intersection coordinates (lat, lon, altitude, distance)
        given a YOLO bounding box and PTZ camera metadata.
        """
        if "camera" not in metadata or "ptz" not in metadata:
            raise ValueError("유효한 메타데이터('camera' 및 'ptz')가 필요합니다.")

        cam = metadata["camera"]
        ptz = metadata["ptz"]

        cam_lat = float(cam["lat"])
        cam_lon = float(cam["lon"])
        width = int(cam.get("resolution_w", 1920))
        height = int(cam.get("resolution_h", 1080))
        fov_h = float(cam.get("fov_h", 60.0))

        dem = self._ensure_dem(cam_lat, cam_lon)
        ground_alt = float(dem.sample(cam_lat, cam_lon))
        tower_h = float(cam.get("tower_height", 15.0))
        eye_alt = float(cam["altitude"]) if "altitude" in cam and cam.get("use_abs_alt") else (ground_alt + tower_h)

        init_pan = float(ptz["pan"])
        init_tilt = float(ptz["tilt"])
        init_roll = float(ptz.get("roll", 0.0))

        # Stage 1: Skyline-based PTZ Self-Calibration (when ridge points are provided & enabled)
        cal_info = {
            "pan": init_pan,
            "tilt": init_tilt,
            "roll": init_roll,
            "d_pan": 0.0,
            "d_tilt": 0.0,
            "rms_deg": 0.0,
            "calibrated": False,
        }
        ridge_pts = metadata.get("ridge_pts")
        if use_skyline_calibration and ridge_pts is not None and len(ridge_pts) >= 3:
            assert self._calibrator is not None
            cal_res = self._calibrator.calibrate_ptz(
                cam_lat=cam_lat,
                cam_lon=cam_lon,
                eye_alt=eye_alt,
                init_pan=init_pan,
                init_tilt=init_tilt,
                ridge_pts=ridge_pts,
                width=width,
                height=height,
                fov_h=fov_h,
            )
            cal_info.update(cal_res)
            cal_info["calibrated"] = True

        cal_pan = cal_info["pan"]
        cal_tilt = cal_info["tilt"]
        cal_roll = cal_info["roll"]

        # Stage 2: Convert 2D Fire Root Pixel -> 3D Ray Bearing & Elevation Angle
        fire_x, fire_y = self.extract_fire_root_pixel(bbox, bottom_inset_ratio=bottom_inset_ratio)
        f = SkylineCalibrator.focal_px(width, fov_h)
        cx, cy = width / 2.0, height / 2.0

        # Inverse roll correction around principal point (cx, cy)
        y_unrolled = fire_y - math.tan(math.radians(cal_roll)) * (fire_x - cx)
        delta_pan = math.degrees(math.atan((fire_x - cx) / f))
        delta_tilt = math.degrees(math.atan((cy - y_unrolled) / f))

        ray_bearing = (cal_pan + delta_pan) % 360.0
        ray_el_deg = cal_tilt + delta_tilt
        tan_el = math.tan(math.radians(ray_el_deg))

        # Note: Even when ray_el_deg >= 0 (dz >= 0, upward/horizontal ray), the ray can still
        # intersect high mountain slopes rising above the camera's altitude. Only reject extreme sky angles.
        if ray_el_deg > 45.0:
            raise ValueError(f"추정 불가: 광선 고도각({ray_el_deg:.2f}°)이 하늘 방향 임계값을 초과했습니다.")

        # Stage 3: Ray Marching along spherical surface + Earth curvature drop
        step_size = 20.0
        max_range = float(cam.get("max_range_m", 10000.0))
        near_dist = float(cam.get("near_m", 30.0))

        prev_d = near_dist
        hit = False
        curr_d = near_dist

        n_steps = int((max_range - near_dist) / step_size)
        for _ in range(n_steps):
            curr_d += step_size
            lat_c, lon_c = dest_point(cam_lat, cam_lon, ray_bearing, curr_d)
            dem_h = float(dem.sample(lat_c, lon_c))
            drop = (curr_d ** 2) / (2.0 * R_EARTH) * (1.0 - K_REFRACTION)
            apparent_dem_z = dem_h - drop
            ray_z = eye_alt + curr_d * tan_el

            if ray_z <= apparent_dem_z:
                hit = True
                break
            prev_d = curr_d

        if not hit:
            raise RuntimeError(
                f"추정 불가: 최대 탐색 거리({max_range:.0f}m) 내에서 지형(DEM)과 교차하지 않았습니다. "
                f"(방위각 {ray_bearing:.2f}°, 고도각 {ray_el_deg:.2f}°)"
            )

        # Stage 4: 10-step Binary Search for sub-decimeter intersection precision
        low_d, high_d = prev_d, curr_d
        for _ in range(10):
            mid_d = (low_d + high_d) / 2.0
            lat_m, lon_m = dest_point(cam_lat, cam_lon, ray_bearing, mid_d)
            dem_h = float(dem.sample(lat_m, lon_m))
            drop = (mid_d ** 2) / (2.0 * R_EARTH) * (1.0 - K_REFRACTION)
            apparent_dem_z = dem_h - drop
            ray_z = eye_alt + mid_d * tan_el

            if ray_z <= apparent_dem_z:
                high_d = mid_d
            else:
                low_d = mid_d

        final_d = (low_d + high_d) / 2.0
        est_lat, est_lon = dest_point(cam_lat, cam_lon, ray_bearing, final_d)
        est_alt = float(dem.sample(est_lat, est_lon))

        return {
            "lat": est_lat,
            "lon": est_lon,
            "altitude_m": est_alt,
            "distance_m": final_d,
            "bearing_deg": ray_bearing,
            "elevation_angle_deg": ray_el_deg,
            "calibration": cal_info,
        }


if __name__ == "__main__":
    # Quick sanity check at Gachang O-ri CCTV coordinate (35.791037, 128.591184)
    cam_lat, cam_lon = 35.791037, 128.591184
    estimator = FireLocationEstimator(zoom=12, dem_radius_m=10000.0)
    dem = estimator._ensure_dem(cam_lat, cam_lon)
    eye_alt = float(dem.sample(cam_lat, cam_lon)) + 15.0

    # Generate synthetic skyline for True Pose: Pan=339.0°, Tilt=+3.0°, Roll=0.8°
    calibrator = SkylineCalibrator(dem)
    ridge_pts = calibrator.synthesize_skyline_pixels(
        cam_lat, cam_lon, eye_alt, true_pan=339.0, true_tilt=3.0, true_roll=0.8
    )

    # Inject +1.0° Pan and -1.0° Tilt error into reported PTZ metadata
    meta = {
        "camera": {
            "lat": cam_lat,
            "lon": cam_lon,
            "tower_height": 15.0,
            "fov_h": 60.0,
            "resolution_w": 1920,
            "resolution_h": 1080,
        },
        "ptz": {"pan": 340.0, "tilt": 2.0},
        "ridge_pts": ridge_pts,
    }
    bbox = [900, 480, 1020, 640]

    res_uncal = estimator.estimate_location(bbox, meta, use_skyline_calibration=False)
    res_cal = estimator.estimate_location(bbox, meta, use_skyline_calibration=True)
    print("=" * 65)
    print("[Sanity Check] 대구 달성군 가창면 오리 CCTV (35.791037, 128.591184)")
    print(f"보정 전 (Un-calibrated): 위도 {res_uncal['lat']:.6f}, 경도 {res_uncal['lon']:.6f}, 거리 {res_uncal['distance_m']:.1f}m")
    print(
        f"보정 후 (Calibrated)   : 위도 {res_cal['lat']:.6f}, 경도 {res_cal['lon']:.6f}, 거리 {res_cal['distance_m']:.1f}m "
        f"(복원된 Pan={res_cal['calibration']['pan']:.2f}°, Tilt={res_cal['calibration']['tilt']:.2f}°, Roll={res_cal['calibration']['roll']:.2f}°)"
    )
    print("=" * 65)
