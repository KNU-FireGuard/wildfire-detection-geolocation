"""
실행 단위 화재 위치 추정 세션 (#60)

- 실행 시작 시 카메라 자세를 1회 결정하고, 탐지마다 같은 자세로 bbox → 위경도 계산
  - 탐지마다 능선 추출·360° 역산을 반복하지 않음 (프레임마다 결과가 흔들리고 느림)
- 자세 결정 순서
  1. ai/config/cameras.json의 고정 자세(fixed_pose) + 화각
- bbox는 YOLO 원본 픽셀 xyxy, 목표점은 bbox 아래 중앙 (연기 발생 지점)
- 반환은 Backend 탐지 JSON의 location_estimation 형식 {latitude, longitude, error_range_m}
- 이동하는 PTZ 카메라는 실행 중 자세가 바뀌므로 대상 아님 (고정 카메라·고정 프리셋 전제)
"""
from __future__ import annotations

from ai.camera_config import find_camera_config


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
