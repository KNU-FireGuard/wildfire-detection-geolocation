from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ai.dem_skyline_calibrator import (
    DEM,
    SkylineCalibrator,
    haversine_distance,
)
from ai.fire_location_estimator import FireLocationEstimator


def run_benchmark() -> None:
    # Gachang O-ri CCTV coordinates
    cam_lat, cam_lon = 35.791037, 128.591184
    tower_height = 15.0
    width, height = 1920, 1080
    fov_h = 60.0

    print("AWS Terrarium DEM 타일 로드 및 모자이크 생성 중 (대구 달성군 가창면 오리 일대)...")
    dem = DEM(center=(cam_lat, cam_lon), radius_m=12000.0, zoom=12)
    estimator = FireLocationEstimator(dem=dem, zoom=12, dem_radius_m=12000.0)
    calibrator = SkylineCalibrator(dem)

    ground_alt = float(dem.sample(cam_lat, cam_lon))
    eye_alt = ground_alt + tower_height
    print(f"카메라 위치: ({cam_lat:.6f}, {cam_lon:.6f}) | 지면 고도: {ground_alt:.1f}m | 카메라 해발고도: {eye_alt:.1f}m\n")

    scenarios = [
        {
            "id": "P339/T03",
            "target_address": "대구 달성군 가창면 오리 416-3",
            "true_pan": 339.0,
            "true_tilt": 3.0,
            "true_roll": 0.8,
            # Smoke plume rising vertically from mountainside (height=160px)
            "bbox": [890.0, 440.0, 1010.0, 600.0],
        },
        {
            "id": "P023/T03",
            "target_address": "대구 달성군 가창면 오리 766-11",
            "true_pan": 23.0,
            "true_tilt": 3.0,
            "true_roll": -0.7,
            # Smoke plume rising from mountainside in NNE sector (height=150px)
            "bbox": [910.0, 430.0, 1030.0, 580.0],
        },
    ]

    error_levels = [0.5, 1.0, 1.5, 2.0]

    for sc in scenarios:
        sc_id = sc["id"]
        addr = sc["target_address"]
        t_pan = sc["true_pan"]
        t_tilt = sc["true_tilt"]
        t_roll = sc["true_roll"]
        bbox = sc["bbox"]

        # Ground-Truth wildfire ignition point (True PTZ + Lower Root 5% inset)
        gt_meta = {
            "camera": {
                "lat": cam_lat,
                "lon": cam_lon,
                "tower_height": tower_height,
                "fov_h": fov_h,
                "resolution_w": width,
                "resolution_h": height,
            },
            "ptz": {"pan": t_pan, "tilt": t_tilt, "roll": t_roll},
        }
        gt_res = estimator.estimate_location(
            bbox, gt_meta, use_skyline_calibration=False, bottom_inset_ratio=0.05
        )
        gt_lat, gt_lon = gt_res["lat"], gt_res["lon"]
        gt_dist = gt_res["distance_m"]
        gt_alt = gt_res["altitude_m"]

        # Observed skyline pixels with realistic edge-detection noise (0.8 px) & 10% tree-branch outliers
        observed_ridge = calibrator.synthesize_skyline_pixels(
            cam_lat=cam_lat,
            cam_lon=cam_lon,
            eye_alt=eye_alt,
            true_pan=t_pan,
            true_tilt=t_tilt,
            true_roll=t_roll,
            width=width,
            height=height,
            fov_h=fov_h,
            step_px=20,
            noise_std_px=0.8,
            outlier_ratio=0.10,
            seed=42,
        )

        print("=" * 92)
        print(f"■ 시나리오 [{sc_id}] 목표 지점: {addr}")
        print(
            f"  - 실제 발화점 Ground-Truth: ({gt_lat:.6f}, {gt_lon:.6f}) | "
            f"해발고도: {gt_alt:.1f}m | 카메라 거리: {gt_dist:.1f}m"
        )
        print(
            f"  - 실제 카메라 자세: Pan={t_pan:.2f}°, Tilt=+{t_tilt:.2f}°, Roll={t_roll:+.2f}° "
            f"(능선 노이즈 σ=0.8px, 이상치 10% 포함)"
        )
        print("-" * 92)
        print(
            f"{'PTZ 오차 수준':^14} | {'기존 (Un-calibrated + 중심점)':^24} | "
            f"{'단순 하단점 (Un-calibrated)':^22} | {'제안 기법 (Skyline 보정 + 하단점)':^24} | {'오차 감소율':^10}"
        )
        print("-" * 92)

        for err in error_levels:
            # 8 directional PTZ mechanical error combinations around true pose
            perturbations = [
                (+err, +err),
                (+err, -err),
                (-err, +err),
                (-err, -err),
                (+err, 0.0),
                (-err, 0.0),
                (0.0, +err),
                (0.0, -err),
            ]

            sq_err_base_center = []
            sq_err_uncal_bottom = []
            sq_err_proposed = []

            for d_pan, d_tilt in perturbations:
                noisy_meta = {
                    "camera": gt_meta["camera"],
                    "ptz": {
                        "pan": (t_pan + d_pan) % 360.0,
                        "tilt": t_tilt + d_tilt,
                        "roll": 0.0,  # Uncalibrated system assumes 0 roll
                    },
                    "ridge_pts": observed_ridge,
                }

                # 1) Conventional Baseline: Un-calibrated PTZ + BBox Center (bottom_inset_ratio=0.50)
                try:
                    r_base = estimator.estimate_location(
                        bbox,
                        noisy_meta,
                        use_skyline_calibration=False,
                        bottom_inset_ratio=0.50,
                    )
                    d_base = haversine_distance(gt_lat, gt_lon, r_base["lat"], r_base["lon"])
                except Exception:
                    # Ray missed the mountain peak entirely due to upward tilt error
                    d_base = 3500.0
                sq_err_base_center.append(d_base ** 2)

                # 2) Ablation: Un-calibrated PTZ + Lower Root (bottom_inset_ratio=0.05)
                try:
                    r_uncal = estimator.estimate_location(
                        bbox,
                        noisy_meta,
                        use_skyline_calibration=False,
                        bottom_inset_ratio=0.05,
                    )
                    d_uncal = haversine_distance(gt_lat, gt_lon, r_uncal["lat"], r_uncal["lon"])
                except Exception:
                    d_uncal = 3500.0
                sq_err_uncal_bottom.append(d_uncal ** 2)

                # 3) Proposed Method: Skyline-calibrated PTZ (Pan/Tilt/Roll) + Lower Root (0.05)
                r_prop = estimator.estimate_location(
                    bbox,
                    noisy_meta,
                    use_skyline_calibration=True,
                    bottom_inset_ratio=0.05,
                )
                d_prop = haversine_distance(gt_lat, gt_lon, r_prop["lat"], r_prop["lon"])
                sq_err_proposed.append(d_prop ** 2)

            rmse_base = math.sqrt(float(np.mean(sq_err_base_center)))
            rmse_uncal = math.sqrt(float(np.mean(sq_err_uncal_bottom)))
            rmse_prop = math.sqrt(float(np.mean(sq_err_proposed)))
            reduction_pct = (1.0 - rmse_prop / rmse_base) * 100.0

            print(
                f"   ±{err:.1f}° 오차   |      RMSE {rmse_base:7.1f} m      | "
                f"     RMSE {rmse_uncal:7.1f} m    |       RMSE {rmse_prop:6.1f} m        |  -{reduction_pct:5.1f}%"
            )
        print("=" * 92 + "\n")


if __name__ == "__main__":
    run_benchmark()
