from __future__ import annotations

import math

try:
    from ai.dem_skyline_engine import (
        DEMProvider,
        GACHANG_CAM_LAT,
        GACHANG_CAM_LON,
        K_REFRACTION,
        R_EARTH,
        dest_point,
    )
except ImportError:
    from dem_skyline_engine import (
        DEMProvider,
        GACHANG_CAM_LAT,
        GACHANG_CAM_LON,
        K_REFRACTION,
        R_EARTH,
        dest_point,
    )


class FireLocationEstimator:
    """
    Single-Track 3D Ray-DEM Wildfire Geolocation Engine (Track 2 Heuristic ROI Removed):
      1. Synthetic Skyline Zero-Point PTZ Calibration (dPan, dTilt, Roll)
      2. YOLO Bounding Box Normalization Auto-Detection & Bottom-Center Ignition Targeting
      3. 3D Unit Direction Vector + 50m Ray Marching + 10-step Binary Search on DEMProvider
    """

    def __init__(self, dem_provider: DEMProvider | None = None):
        self.dem_provider = dem_provider

    def _get_provider(self, cam_lat: float, cam_lon: float, tower_height: float) -> DEMProvider:
        if (
            self.dem_provider is None
            or abs(self.dem_provider.cam_lat - cam_lat) > 1e-4
            or abs(self.dem_provider.cam_lon - cam_lon) > 1e-4
        ):
            self.dem_provider = DEMProvider(
                cam_lat=cam_lat, cam_lon=cam_lon, tower_height_m=tower_height
            )
        return self.dem_provider

    @staticmethod
    def resolve_target_pixel(
        bbox: list[float] | tuple[float, float, float, float],
        width: int = 1920,
        height: int = 1080,
        target_mode: str = "bottom_center",
        bbox_format: str = "xyxy",
    ) -> tuple[float, float]:
        """
        Convert YOLO bounding box (either 0~1 normalized or pixel coordinates) to target pixel (fire_x, fire_y).
        - target_mode="bottom_center": (x_center, y_max) corresponding to the ground ignition base
        - target_mode="center": (x_center, y_center) corresponding to the smoke plume center
        """
        b0, b1, b2, b3 = (float(v) for v in bbox)
        is_normalized = max(b0, b1, b2, b3) <= 1.0

        if bbox_format == "xywh":
            xc, yc, w, h = b0, b1, b2, b3
            if is_normalized:
                xc, w = xc * width, w * width
                yc, h = yc * height, h * height
            x_min, x_max = xc - w / 2.0, xc + w / 2.0
            y_min, y_max = yc - h / 2.0, yc + h / 2.0
        else:
            x_min, y_min, x_max, y_max = b0, b1, b2, b3
            if is_normalized:
                x_min, x_max = x_min * width, x_max * width
                y_min, y_max = y_min * height, y_max * height

        fire_x = (x_min + x_max) / 2.0
        if target_mode == "center":
            fire_y = (y_min + y_max) / 2.0
        else:
            # Bottom-Center (lower edge of bounding box)
            fire_y = y_max

        return fire_x, fire_y

    @staticmethod
    def compute_3d_ray_vector(
        fire_x: float,
        fire_y: float,
        pan_deg: float,
        tilt_deg: float,
        roll_deg: float,
        width: int = 1920,
        height: int = 1080,
        fov_h_deg: float = 60.0,
    ) -> tuple[tuple[float, float, float], float, float]:
        """
        Compute the 3D ENU unit direction vector (dx, dy, dz), azimuth bearing (deg),
        and elevation angle (deg) from calibrated PTZ and focal length.
        """
        f = (width / 2.0) / math.tan(math.radians(fov_h_deg / 2.0))
        cx, cy = width / 2.0, height / 2.0

        # Inverse roll rotation around principal point
        y_unrolled = fire_y - math.tan(math.radians(roll_deg)) * (fire_x - cx)
        delta_pan = math.degrees(math.atan((fire_x - cx) / f))
        delta_tilt = math.degrees(math.atan((cy - y_unrolled) / f))

        final_pan_deg = (pan_deg + delta_pan) % 360.0
        final_tilt_deg = tilt_deg + delta_tilt

        pan_rad = math.radians(final_pan_deg)
        tilt_rad = math.radians(final_tilt_deg)

        # 3D unit vector in local ENU frame (X: East, Y: North, Z: Up)
        dx = math.sin(pan_rad) * math.cos(tilt_rad)
        dy = math.cos(pan_rad) * math.cos(tilt_rad)
        dz = math.sin(tilt_rad)
        return (dx, dy, dz), final_pan_deg, final_tilt_deg

    def estimate_location(
        self,
        bbox: list[float] | tuple[float, float, float, float],
        metadata: dict,
        target_mode: str = "bottom_center",
        terrain_mode: str = "3d_dem",
        use_skyline_calibration: bool = True,
        step_size_m: float = 50.0,
        binary_search_iters: int = 10,
    ) -> dict:
        """
        Estimate wildfire ignition coordinates (lat, lon, altitude_m, distance_m)
        using 50m Ray Marching + 10-step Binary Search on DEMProvider.
        Note: Supports upward rays (dz >= 0) intersecting high mountainsides above camera level.
        """
        if "camera" not in metadata or "ptz" not in metadata:
            raise ValueError("메타데이터에 'camera' 및 'ptz' 필드가 필요합니다.")

        cam = metadata["camera"]
        ptz = metadata["ptz"]

        cam_lat = float(cam.get("lat", GACHANG_CAM_LAT))
        cam_lon = float(cam.get("lon", GACHANG_CAM_LON))
        tower_h = float(cam.get("tower_height", 15.0))
        width = int(cam.get("resolution_w", 1920))
        height = int(cam.get("resolution_h", 1080))
        fov_h = float(cam.get("fov_h", 60.0))

        provider = self._get_provider(cam_lat, cam_lon, tower_h)
        ground_alt = provider.ground_alt
        eye_alt = float(cam["altitude"]) if "altitude" in cam and cam.get("use_abs_alt") else provider.eye_alt

        init_pan = float(ptz["pan"])
        init_tilt = float(ptz["tilt"])
        init_roll = float(ptz.get("roll", 0.0))

        # 1. Optional Synthetic Skyline Zero-Point Calibration
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
            cal_res = provider.calibrate_ptz_zero_point(
                init_pan=init_pan,
                init_tilt=init_tilt,
                ridge_pts=ridge_pts,
                width=width,
                height=height,
                fov_h=fov_h,
            )
            cal_info.update(cal_res)
            cal_info["calibrated"] = True

        # 2. Target Pixel & 3D Unit Direction Vector (dz >= 0 upward rays are allowed!)
        fire_x, fire_y = self.resolve_target_pixel(
            bbox, width=width, height=height, target_mode=target_mode
        )
        (dx, dy, dz), ray_bearing, ray_el_deg = self.compute_3d_ray_vector(
            fire_x=fire_x,
            fire_y=fire_y,
            pan_deg=cal_info["pan"],
            tilt_deg=cal_info["tilt"],
            roll_deg=cal_info["roll"],
            width=width,
            height=height,
            fov_h_deg=fov_h,
        )

        horiz_norm = max(math.hypot(dx, dy), 1e-9)
        slope_dz_per_m = dz / horiz_norm

        near_m = float(cam.get("near_m", 200.0))
        max_range_m = float(cam.get("max_range_m", 5000.0))

        # Baseline Flat-Earth mode (ignores 3D mountain terrain relief)
        if terrain_mode == "flat_earth":
            ref_plane_alt = ground_alt + float(cam.get("flat_plane_offset_m", 0.0))
            if abs(slope_dz_per_m) < 1e-5:
                flat_d = 2000.0
            else:
                flat_d = (ref_plane_alt - eye_alt) / slope_dz_per_m
                if flat_d <= 0.0:
                    # Upward ray never hits a flat ground plane below the camera -> diverges to max range
                    flat_d = max_range_m
                else:
                    flat_d = min(max(flat_d, near_m), max_range_m)

            est_lat, est_lon = dest_point(cam_lat, cam_lon, ray_bearing, flat_d)
            return {
                "lat": est_lat,
                "lon": est_lon,
                "altitude_m": ref_plane_alt,
                "distance_m": flat_d,
                "bearing_deg": ray_bearing,
                "elevation_angle_deg": ray_el_deg,
                "ray_vector": (dx, dy, dz),
                "calibration": cal_info,
            }

        # 3. 3D DEM Ray Marching (50m step forward)
        prev_d = near_m
        curr_d = near_m
        hit = False
        n_steps = int((max_range_m - near_m) / step_size_m)

        for _ in range(n_steps):
            curr_d += step_size_m
            lat_c, lon_c = dest_point(cam_lat, cam_lon, ray_bearing, curr_d)
            dem_z = float(provider.get_elevation(lat_c, lon_c))
            drop = (curr_d ** 2) / (2.0 * R_EARTH) * (1.0 - K_REFRACTION)
            apparent_dem_z = dem_z - drop
            ray_z = eye_alt + curr_d * slope_dz_per_m

            if ray_z <= apparent_dem_z:
                hit = True
                break
            prev_d = curr_d

        if not hit:
            # If ray grazed slightly above the peak due to severe upward tilt error, clamp to max horizon peak
            curr_d = max_range_m
            prev_d = max_range_m - step_size_m

        # 4. 10-step Binary Search for sub-decimeter surface intersection precision
        low_d, high_d = prev_d, curr_d
        for _ in range(binary_search_iters):
            mid_d = (low_d + high_d) / 2.0
            lat_m, lon_m = dest_point(cam_lat, cam_lon, ray_bearing, mid_d)
            dem_z = float(provider.get_elevation(lat_m, lon_m))
            drop = (mid_d ** 2) / (2.0 * R_EARTH) * (1.0 - K_REFRACTION)
            apparent_dem_z = dem_z - drop
            ray_z = eye_alt + mid_d * slope_dz_per_m

            if ray_z <= apparent_dem_z:
                high_d = mid_d
            else:
                low_d = mid_d

        final_d = (low_d + high_d) / 2.0
        est_lat, est_lon = dest_point(cam_lat, cam_lon, ray_bearing, final_d)
        est_alt = float(provider.get_elevation(est_lat, est_lon))

        return {
            "lat": est_lat,
            "lon": est_lon,
            "altitude_m": est_alt,
            "distance_m": final_d,
            "bearing_deg": ray_bearing,
            "elevation_angle_deg": ray_el_deg,
            "ray_vector": (dx, dy, dz),
            "calibration": cal_info,
        }


if __name__ == "__main__":
    estimator = FireLocationEstimator()
    provider = estimator._get_provider(GACHANG_CAM_LAT, GACHANG_CAM_LON, 15.0)
    ridge = provider.synthesize_observed_skyline(true_pan=339.0, true_tilt=3.0, true_roll=0.5)

    # Test with YOLO normalized bbox [x_min, y_min, x_max, y_max] in 0..1 range
    norm_bbox = [0.468, 0.360, 0.532, 0.495]
    meta = {
        "camera": {
            "lat": GACHANG_CAM_LAT,
            "lon": GACHANG_CAM_LON,
            "tower_height": 15.0,
            "fov_h": 60.0,
            "resolution_w": 1920,
            "resolution_h": 1080,
            "near_m": 250.0,
        },
        "ptz": {"pan": 340.0, "tilt": 2.0},
        "ridge_pts": ridge,
    }
    res = estimator.estimate_location(norm_bbox, meta, use_skyline_calibration=True)
    print(
        f"[FireLocationEstimator 테스트] 추정 좌표: ({res['lat']:.6f}, {res['lon']:.6f}), "
        f"해발고도: {res['altitude_m']:.1f}m, 거리: {res['distance_m']:.1f}m"
    )
