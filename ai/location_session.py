"""
실행 단위 화재 위치 추정 세션 (#60)

- 실행 시작 시 카메라 자세를 1회 결정하고, 탐지마다 같은 자세로 bbox → 위경도 계산
  - 탐지마다 능선 추출·360° 역산을 반복하지 않음 (프레임마다 결과가 흔들리고 느림)
- 자세 결정 순서
  1. ai/config/cameras.json의 고정 자세(fixed_pose) + 화각
  2. 고정 자세가 없으면 첫 프레임 능선으로 360° 역산 1회 (화각은 설정값, 없으면 기본 60° + FOV_DEFAULT_USED)
- bbox는 YOLO 원본 픽셀 xyxy, 목표점은 bbox 아래 중앙 (연기 발생 지점)
- 반환은 Backend 탐지 JSON의 location_estimation 형식 {latitude, longitude, error_range_m}
- 이동하는 PTZ 카메라는 실행 중 자세가 바뀌므로 대상 아님 (고정 카메라·고정 프리셋 전제)
"""
from __future__ import annotations

from ai.camera_config import find_camera_config

DEFAULT_FOV_H_DEG = 60.0  # FireLocationEstimator 코드 기본값과 동일


class LocationSession:
    def __init__(self, camera: dict, estimator=None):
        """camera: {"id": DB ID, "name": DB 이름, "lat": 위도, "lon": 경도}"""
        if estimator is None:
            from ai.fire_location_estimator import FireLocationEstimator

            estimator = FireLocationEstimator()
        self.camera = dict(camera)
        self.estimator = estimator
        self.config = find_camera_config(estimator.camera_configs, camera_id=camera.get("id"), name=camera.get("name"))
        self.status: dict = {"ready": False, "reason": "NOT_PREPARED"}
        self.frame_size: tuple[int, int] | None = None

    def prepare(self, frame=None, frame_size: tuple[int, int] | None = None) -> dict:
        """실행 시작 시 1회 호출, 자세·화각을 정해 status에 기록"""
        self.frame_size = tuple(frame_size) if frame_size is not None else None
        cfg = self.config
        if cfg is not None and cfg.get("fixed_pose"):
            pose = cfg["fixed_pose"]
            self.status = {
                "ready": True,
                "mode": "config_fixed_pose",
                "config_key": cfg["key"],
                "fov_h_deg": float(cfg["fov_h_deg"]),
                "pan": float(pose["pan"]),
                "tilt": float(pose["tilt"]),
                "roll": float(pose["roll"]),
                "tower_height_m": cfg.get("tower_height_m"),
                "warnings": [],
            }
            return self.status
        return self._prepare_blind(frame, cfg)

    def _prepare_blind(self, frame, cfg: dict | None) -> dict:
        """고정 자세가 없으면 첫 프레임 능선으로 360° 역산 1회 (#56 게이트 통과 시에만 사용)"""
        fov = float(cfg["fov_h_deg"]) if cfg is not None else DEFAULT_FOV_H_DEG
        tower_h = cfg.get("tower_height_m") if cfg is not None else None
        base = {
            "ready": False,
            "mode": "blind_360_once",
            "config_key": cfg["key"] if cfg is not None else None,
            "fov_h_deg": fov,
            "tower_height_m": tower_h,
            # 보정 설정이 없으면 코드 기본 화각 사용, 실제 렌즈와 크게 다를 수 있음
            "warnings": [] if cfg is not None else ["FOV_DEFAULT_USED"],
        }
        if frame is None or self.frame_size is None:
            self.status = {**base, "reason": "NO_FRAME_FOR_CALIBRATION"}
            return self.status
        ext = self.estimator.skyline_extractor.extract(frame=frame)
        if not ext["is_valid"]:
            self.status = {**base, "reason": "RIDGE_NOT_DETECTED"}
            return self.status
        provider = self.estimator._get_provider(
            float(self.camera["lat"]), float(self.camera["lon"]), float(tower_h) if tower_h is not None else 15.0
        )
        w, h = self.frame_size
        blind = provider.estimate_blind_ptz(ridge_pts=ext["ridge_pts"], width=w, height=h, fov_h=fov)
        if not blind.get("calibrated", False):
            self.status = {**base, "reason": blind.get("reason") or "CALIBRATION_FAILED"}
            return self.status
        self.status = {
            **base,
            "ready": True,
            "pan": float(blind["pan"]),
            "tilt": float(blind["tilt"]),
            "roll": float(blind["roll"]),
            "uniqueness_ratio": blind.get("uniqueness_ratio"),
        }
        return self.status

    def locate(self, bbox_xyxy) -> dict | None:
        """탐지 bbox(원본 픽셀 xyxy) → location_estimation, 계산할 수 없으면 None"""
        st = self.status
        w, h = self.frame_size
        cam = {
            "id": self.camera.get("id"),
            "name": self.camera.get("name"),
            "lat": float(self.camera["lat"]),
            "lon": float(self.camera["lon"]),
            "fov_h": st["fov_h_deg"],
            "resolution_w": w,
            "resolution_h": h,
        }
        if st.get("tower_height_m") is not None:
            cam["tower_height"] = float(st["tower_height_m"])
        result = self.estimator.estimate_location(
            list(bbox_xyxy),
            {
                "camera": cam,
                "ptz": {"pan": st["pan"], "tilt": st["tilt"], "roll": st["roll"], "mode": st["mode"]},
                "bbox_format": "xyxy",
                "bbox_normalized": False,
            },
            use_skyline_calibration=False,
        )
        return result.get("location_estimation")
