from __future__ import annotations

import math
from pathlib import Path

try:
    from ai.camera_model import pixel_to_vector
    from ai.dem_skyline_engine import (
        DEMProvider,
        GACHANG_CAM_LAT,
        GACHANG_CAM_LON,
        K_REFRACTION,
        R_EARTH,
        dest_point,
        haversine_distance,
    )
    from ai.ridge_detector import SkylineExtractor
except ImportError:
    from camera_model import pixel_to_vector
    from dem_skyline_engine import (
        DEMProvider,
        GACHANG_CAM_LAT,
        GACHANG_CAM_LON,
        K_REFRACTION,
        R_EARTH,
        dest_point,
        haversine_distance,
    )
    from ridge_detector import SkylineExtractor


class FireLocationEstimator:
    """
    Single-Track 3D Ray-DEM Wildfire Geolocation Engine (Track 2 Heuristic ROI Removed):
      1. Automatic Frame Skyline Extraction (SkylineExtractor) & Smoke BBox Masking
      2. Synthetic Skyline Zero-Point PTZ Calibration & 360° Blind Pose Estimation (ptz=None)
      3. YOLO Bounding Box (xyxy / xywh / API dict) Auto-Detection & Bottom-Center Targeting
      4. 3D Unit Direction Vector + 50m Ray Marching + 10-step Binary Search on DEMProvider
    """

    def __init__(
        self,
        dem_provider: DEMProvider | None = None,
        skyline_extractor: SkylineExtractor | None = None,
    ):
        self.dem_provider = dem_provider
        self.skyline_extractor = skyline_extractor or SkylineExtractor()

    def _get_provider(
        self,
        cam_meta_or_lat: dict | float = GACHANG_CAM_LAT,
        cam_lon: float | None = None,
        tower_height: float = 15.0,
    ) -> DEMProvider:
        """
        Return the DEMProvider, automatically updating when either camera coordinates
        differ by > 10m or tower_height differs by > 0.1m.
        Supports both _get_provider(cam_meta) and _get_provider(lat, lon, tower_h).
        """
        if isinstance(cam_meta_or_lat, dict):
            cam = cam_meta_or_lat.get("camera", cam_meta_or_lat)
            lat = float(cam.get("lat", GACHANG_CAM_LAT))
            lon = float(cam.get("lon", GACHANG_CAM_LON))
            t_h = float(cam.get("tower_height", 15.0))
        else:
            lat = float(cam_meta_or_lat)
            lon = float(cam_lon if cam_lon is not None else GACHANG_CAM_LON)
            t_h = float(tower_height)

        need_new = (
            self.dem_provider is None
            or haversine_distance(self.dem_provider.cam_lat, self.dem_provider.cam_lon, lat, lon) > 10.0
            or abs(self.dem_provider.tower_height_m - t_h) > 0.1
        )
        if need_new:
            self.dem_provider = DEMProvider(
                cam_lat=lat, cam_lon=lon, tower_height_m=t_h
            )
        return self.dem_provider

    BBOX_FORMATS = ("xyxy", "xywh", "cxcyhw")
    BBOX_PIXEL_TOLERANCE = 2.0

    @staticmethod
    def resolve_bbox_pixel_bounds(
        bbox: list[float] | tuple[float, float, float, float] | dict[str, float | int],
        width: int = 1920,
        height: int = 1080,
        bbox_format: str = "xyxy",
        normalized: bool | None = None,
    ) -> tuple[float, float, float, float]:
        """
        Convert any bounding box into pixel bounds (x_min_px, y_min_px, x_max_px, y_max_px)
        of the original frame (width x height).

        bbox_format:
          - "xyxy":   [x_min, y_min, x_max, y_max]  (ultralytics boxes.xyxy, Backend API dict)
          - "xywh":   [x_center, y_center, width, height]  (standard YOLO, ultralytics boxes.xywh[n])
          - "cxcyhw": [x_center, y_center, height, width]  (height before width)
        normalized:
          - True:  values must be within 0~1 (relative to the original frame), else ValueError
          - False: values are original-frame pixels
          - None:  legacy auto-detect (all values <= 1.0 -> normalized); prefer an explicit flag
        Backend API dict {"x1", "y1", "x2", "y2"} is always interpreted as xyxy pixels.
        Raises ValueError for unknown formats, flipped / empty boxes, and boxes outside the frame.
        """
        if isinstance(bbox, dict):
            if all(k in bbox for k in ("x1", "y1", "x2", "y2")):
                b0, b1, b2, b3 = float(bbox["x1"]), float(bbox["y1"]), float(bbox["x2"]), float(bbox["y2"])
            elif all(k in bbox for k in ("xmin", "ymin", "xmax", "ymax")):
                b0, b1, b2, b3 = float(bbox["xmin"]), float(bbox["ymin"]), float(bbox["xmax"]), float(bbox["ymax"])
            else:
                raise ValueError("bbox 딕셔너리에 x1, y1, x2, y2 키가 필요합니다.")
            fmt = "xyxy"
            if normalized is None:
                normalized = False
        else:
            values = tuple(float(v) for v in bbox)
            if len(values) != 4:
                raise ValueError("bbox는 4개의 값이어야 합니다.")
            b0, b1, b2, b3 = values
            fmt = bbox_format

        if fmt not in FireLocationEstimator.BBOX_FORMATS:
            raise ValueError(f"지원하지 않는 bbox 포맷입니다: {fmt!r} (지원: {FireLocationEstimator.BBOX_FORMATS})")
        if not all(math.isfinite(v) for v in (b0, b1, b2, b3)):
            raise ValueError("bbox 값이 유한한 숫자가 아닙니다.")

        is_normalized = (max(b0, b1, b2, b3) <= 1.0) if normalized is None else bool(normalized)
        if is_normalized and (min(b0, b1, b2, b3) < 0.0 or max(b0, b1, b2, b3) > 1.0):
            raise ValueError("정규화 bbox 값은 0~1 범위여야 합니다.")

        sx = float(width) if is_normalized else 1.0
        sy = float(height) if is_normalized else 1.0

        if fmt == "xyxy":
            x_min, y_min, x_max, y_max = b0 * sx, b1 * sy, b2 * sx, b3 * sy
        else:
            xc, yc = b0 * sx, b1 * sy
            if fmt == "xywh":
                w, h = b2 * sx, b3 * sy
            else:  # cxcyhw
                h, w = b2 * sy, b3 * sx
            x_min, x_max = xc - w / 2.0, xc + w / 2.0
            y_min, y_max = yc - h / 2.0, yc + h / 2.0

        if x_min >= x_max or y_min >= y_max:
            raise ValueError("bbox가 비어 있거나 뒤집혀 있습니다.")
        tol = FireLocationEstimator.BBOX_PIXEL_TOLERANCE
        if x_min < -tol or y_min < -tol or x_max > width + tol or y_max > height + tol:
            raise ValueError(f"bbox가 프레임({width}x{height}) 범위를 벗어납니다.")

        return float(x_min), float(y_min), float(x_max), float(y_max)

    @staticmethod
    def resolve_target_pixel(
        bbox: list[float] | tuple[float, float, float, float] | dict[str, float | int],
        width: int = 1920,
        height: int = 1080,
        target_mode: str = "bottom_center",
        bbox_format: str = "xyxy",
        normalized: bool | None = None,
    ) -> tuple[float, float]:
        """
        Convert a bounding box (see resolve_bbox_pixel_bounds) to target pixel (fire_x, fire_y).
        - target_mode="bottom_center": (x_center, y_max) corresponding to the ground ignition base
        - target_mode="center": (x_center, y_center) corresponding to the smoke plume center
        """
        x_min, y_min, x_max, y_max = FireLocationEstimator.resolve_bbox_pixel_bounds(
            bbox, width=width, height=height, bbox_format=bbox_format, normalized=normalized
        )
        fire_x = (x_min + x_max) / 2.0
        if target_mode == "center":
            fire_y = (y_min + y_max) / 2.0
        else:
            # Bottom-Center (lower edge of bounding box)
            fire_y = y_max

        return fire_x, fire_y

    @staticmethod
    def _frame_size(frame: object) -> tuple[int, int] | None:
        """Return (width, height) of a frame given as np.ndarray, PIL.Image or file path, else None."""
        if frame is None:
            return None
        try:
            if isinstance(frame, (str, Path)):
                from PIL import Image

                with Image.open(frame) as img:
                    return int(img.size[0]), int(img.size[1])
            if hasattr(frame, "size") and hasattr(frame, "convert"):  # PIL.Image
                return int(frame.size[0]), int(frame.size[1])  # type: ignore[attr-defined]
            shape = getattr(frame, "shape", None)
            if shape is not None and len(shape) >= 2:
                return int(shape[1]), int(shape[0])
        except Exception:
            return None
        return None

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
        and elevation angle (deg) of the ray through pixel (fire_x, fire_y),
        using the exact pinhole yaw-pitch-roll model (ai/camera_model.py).
        """
        d = pixel_to_vector(fire_x, fire_y, pan_deg, tilt_deg, roll_deg, width, height, fov_h_deg)
        dx, dy, dz = (float(v) for v in d)
        bearing = math.degrees(math.atan2(dx, dy)) % 360.0
        elevation = math.degrees(math.asin(max(-1.0, min(1.0, dz))))
        return (dx, dy, dz), bearing, elevation

    def estimate_location(
        self,
        bbox: list[float] | tuple[float, float, float, float] | dict[str, float | int],
        metadata: dict,
        target_mode: str = "bottom_center",
        terrain_mode: str = "3d_dem",
        use_skyline_calibration: bool = True,
        step_size_m: float = 50.0,
        binary_search_iters: int = 10,
        bbox_format: str = "xyxy",
        bbox_normalized: bool | None = None,
    ) -> dict:
        """
        Estimate wildfire ignition coordinates (lat, lon, altitude_m, distance_m)
        using 50m Ray Marching + 10-step Binary Search on DEMProvider.
        Supports:
          - Upward rays (dz >= 0) intersecting high mountainsides above camera level
          - Automatic skyline extraction from metadata["frame"] with smoke bbox horizontal masking
          - Missing PTZ (ptz=None) via default_pan/default_tilt or 360° Blind Pose Estimation
          - bbox as "xyxy", "xywh", or Backend API dict {"x1", "y1", "x2", "y2"}
        """
        if "camera" not in metadata:
            raise ValueError("메타데이터에 'camera' 필드가 필요합니다.")

        cam = metadata["camera"]
        ptz = metadata.get("ptz")

        cam_lat = float(cam.get("lat", GACHANG_CAM_LAT))
        cam_lon = float(cam.get("lon", GACHANG_CAM_LON))
        tower_h = float(cam.get("tower_height", 15.0))
        width = int(cam.get("resolution_w", 1920))
        height = int(cam.get("resolution_h", 1080))
        fov_h = float(cam.get("fov_h", 60.0))

        # The frame the detector actually analysed defines the pixel space of the bbox:
        # prefer its real size over the (default 1920x1080) camera metadata resolution
        frame_size = self._frame_size(metadata.get("frame"))
        if frame_size is not None:
            width, height = frame_size

        provider = self._get_provider(cam_lat, cam_lon, tower_h)
        ground_alt = provider.ground_alt
        eye_alt = float(cam["altitude"]) if "altitude" in cam and cam.get("use_abs_alt") else provider.eye_alt

        # Convert bbox into pixel coordinates first so smoke horizontal masking gets [x_min_px, x_max_px]
        fmt = metadata.get("bbox_format", bbox_format)
        norm_flag = metadata.get("bbox_normalized", bbox_normalized)
        try:
            x_min_px, y_min_px, x_max_px, y_max_px = self.resolve_bbox_pixel_bounds(
                bbox, width=width, height=height, bbox_format=fmt, normalized=norm_flag
            )
        except ValueError as exc:
            return {
                "intersected": False,
                "status": "INVALID_BBOX",
                "reason": str(exc),
                "lat": None,
                "lon": None,
                "altitude_m": None,
                "distance_m": None,
                "bearing_deg": None,
                "elevation_angle_deg": None,
                "ray_vector": None,
                "calibration": None,
                "location_estimation": None,
            }
        fire_x = (x_min_px + x_max_px) / 2.0
        fire_y = (y_min_px + y_max_px) / 2.0 if target_mode == "center" else y_max_px

        # 0. Automatic Frame Skyline Extraction (when ridge_pts is not explicitly passed)
        ridge_pts = metadata.get("ridge_pts")
        frame = metadata.get("frame")
        has_ptz = (
            isinstance(ptz, dict)
            and ptz.get("pan") is not None
            and ptz.get("tilt") is not None
        )
        has_default_ptz = (
            cam.get("default_pan") is not None and cam.get("default_tilt") is not None
        )

        ridge_extraction_info: dict | None = None
        if ridge_pts is None and frame is not None and (use_skyline_calibration or not has_ptz):
            ext_res = self.skyline_extractor.extract(
                frame=frame,
                smoke_x_range=(x_min_px, x_max_px),
            )
            ridge_extraction_info = {
                "is_valid": bool(ext_res["is_valid"]),
                "confidence": float(ext_res["confidence"]),
                "mean_drop": float(ext_res["mean_drop"]),
                "num_points": int(len(ext_res["ridge_pts"])),  # type: ignore[arg-type]
            }
            if ext_res["is_valid"]:
                ridge_pts = ext_res["ridge_pts"]

        # 1. Camera Pose Resolution: Known PTZ vs Default PTZ vs 360° Blind Pose Estimation
        if has_ptz:
            init_pan = float(ptz["pan"])  # type: ignore[index]
            init_tilt = float(ptz["tilt"])  # type: ignore[index]
            init_roll = float(ptz.get("roll", 0.0))  # type: ignore[union-attr]
            cal_info: dict = {
                "pan": init_pan,
                "tilt": init_tilt,
                "roll": init_roll,
                "d_pan": 0.0,
                "d_tilt": 0.0,
                "rms_deg": 0.0,
                "calibrated": False,
                "mode": "ptz_known",
            }
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
        elif has_default_ptz:
            init_pan = float(cam["default_pan"])
            init_tilt = float(cam["default_tilt"])
            init_roll = float(cam.get("default_roll", 0.0))
            cal_info = {
                "pan": init_pan,
                "tilt": init_tilt,
                "roll": init_roll,
                "d_pan": 0.0,
                "d_tilt": 0.0,
                "rms_deg": 0.0,
                "calibrated": False,
                "mode": "default_ptz",
            }
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
        else:
            # Blind Pose Estimation (360° Coarse-to-Fine Skyline Matching with 3-way Fail-Safe)
            if ridge_pts is None or len(ridge_pts) < 15:
                cal_info = {
                    "pan": None,
                    "tilt": None,
                    "roll": None,
                    "d_pan": 0.0,
                    "d_tilt": 0.0,
                    "rms_deg": 999.0,
                    "calibrated": False,
                    "status": "CALIBRATION_FAILED",
                    "mode": "blind_360",
                }
                if ridge_extraction_info is not None:
                    cal_info["ridge_extraction"] = ridge_extraction_info
                return {
                    "intersected": False,
                    "status": "CALIBRATION_FAILED",
                    "lat": None,
                    "lon": None,
                    "altitude_m": None,
                    "distance_m": None,
                    "bearing_deg": None,
                    "elevation_angle_deg": None,
                    "ray_vector": None,
                    "calibration": cal_info,
                    "location_estimation": None,
                }

            blind_res = provider.estimate_blind_ptz(
                ridge_pts=ridge_pts,
                width=width,
                height=height,
                fov_h=fov_h,
            )
            cal_info = dict(blind_res)
            cal_info["mode"] = "blind_360"
            if ridge_extraction_info is not None:
                cal_info["ridge_extraction"] = ridge_extraction_info

            if not blind_res.get("calibrated", False):
                return {
                    "intersected": False,
                    "status": "CALIBRATION_FAILED",
                    "lat": None,
                    "lon": None,
                    "altitude_m": None,
                    "distance_m": None,
                    "bearing_deg": None,
                    "elevation_angle_deg": None,
                    "ray_vector": None,
                    "calibration": cal_info,
                    "location_estimation": None,
                }

        if ridge_extraction_info is not None:
            cal_info["ridge_extraction"] = ridge_extraction_info

        # 2. 3D Unit Direction Vector (dz >= 0 upward rays are allowed!)
        (dx, dy, dz), ray_bearing, ray_el_deg = self.compute_3d_ray_vector(
            fire_x=fire_x,
            fire_y=fire_y,
            pan_deg=float(cal_info["pan"]),
            tilt_deg=float(cal_info["tilt"]),
            roll_deg=float(cal_info["roll"]),
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
                flat_d = None
            else:
                flat_d = (ref_plane_alt - eye_alt) / slope_dz_per_m

            if flat_d is None or flat_d <= 0.0 or flat_d > max_range_m:
                # Upward or out-of-range ray never hits a flat ground plane below the camera
                return {
                    "intersected": False,
                    "status": "NO_INTERSECTION",
                    "lat": None,
                    "lon": None,
                    "altitude_m": None,
                    "distance_m": None,
                    "bearing_deg": ray_bearing,
                    "elevation_angle_deg": ray_el_deg,
                    "ray_vector": (dx, dy, dz),
                    "calibration": cal_info,
                    "location_estimation": None,
                }

            flat_d = max(flat_d, near_m)
            est_lat, est_lon = dest_point(cam_lat, cam_lon, ray_bearing, flat_d)
            return {
                "intersected": True,
                "status": "OK",
                "lat": est_lat,
                "lon": est_lon,
                "altitude_m": ref_plane_alt,
                "distance_m": flat_d,
                "bearing_deg": ray_bearing,
                "elevation_angle_deg": ray_el_deg,
                "ray_vector": (dx, dy, dz),
                "calibration": cal_info,
                "location_estimation": {
                    "latitude": round(est_lat, 6),
                    "longitude": round(est_lon, 6),
                    # 오차 범위 산출 모델이 없어 null (임의 수식 금지, 후속 이슈에서 민감도 기반 산출)
                    "error_range_m": None,
                },
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
            # Ray escaped to the sky without intersecting any terrain up to max_range_m
            return {
                "intersected": False,
                "status": "NO_INTERSECTION",
                "lat": None,
                "lon": None,
                "altitude_m": None,
                "distance_m": None,
                "bearing_deg": ray_bearing,
                "elevation_angle_deg": ray_el_deg,
                "ray_vector": (dx, dy, dz),
                "calibration": cal_info,
                "location_estimation": None,
            }

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
            "intersected": True,
            "status": "OK",
            "lat": est_lat,
            "lon": est_lon,
            "altitude_m": est_alt,
            "distance_m": final_d,
            "bearing_deg": ray_bearing,
            "elevation_angle_deg": ray_el_deg,
            "ray_vector": (dx, dy, dz),
            "calibration": cal_info,
            "location_estimation": {
                "latitude": round(est_lat, 6),
                "longitude": round(est_lon, 6),
                # 오차 범위 산출 모델이 없어 null (임의 수식 금지, 후속 이슈에서 민감도 기반 산출)
                "error_range_m": None,
            },
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
