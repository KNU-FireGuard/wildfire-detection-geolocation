"""
카메라별 보정 설정 (ADR 0018)

- 위경도는 DB(cameras) 값을 쓰고, 이 파일에는 보정 결과만 저장
- 우선순위: 호출자가 메타데이터로 명시한 값 > 이 설정 파일 > 코드 기본값
- 형식 (ai/config/cameras.json)
  {
    "version": 1,
    "cameras": [
      {
        "key": "고유 키", "name": "DB 카메라 이름", "camera_id": DB ID 또는 null,
        "fov_h_deg": 수평 화각,
        "eye_altitude_m": 카메라 눈높이 해발(선택), "tower_height_m": 지면 위 높이(선택),
        "ptz": {"pan_offset_deg": 라벨 → 진북 방위 오프셋(선택),
                "presets": {"라벨": {"pan": .., "tilt": .., "roll": ..}}},
        "fixed_pose": {"pan": .., "tilt": .., "roll": ..} (PTZ 없는 고정 카메라, 선택),
        "provenance": "값의 출처", "uncertainty": {...}
      }
    ]
  }
"""
from __future__ import annotations

import json
import math
from pathlib import Path

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent / "config" / "cameras.json"


class CameraConfigError(ValueError):
    """보정 설정 파일 형식 오류"""


def _number(value: object, where: str, lo: float | None = None, hi: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise CameraConfigError(f"{where}: 유한한 숫자여야 합니다 ({value!r})")
    v = float(value)
    if (lo is not None and v <= lo) or (hi is not None and v >= hi):
        raise CameraConfigError(f"{where}: {lo} < 값 < {hi} 범위여야 합니다 ({v})")
    return v


def _pose(value: object, where: str) -> dict[str, float]:
    if not isinstance(value, dict) or any(k not in value for k in ("pan", "tilt", "roll")):
        raise CameraConfigError(f"{where}: pan, tilt, roll이 모두 필요합니다")
    return {
        "pan": _number(value["pan"], f"{where}.pan") % 360.0,
        "tilt": _number(value["tilt"], f"{where}.tilt", -90.0, 90.0),
        "roll": _number(value["roll"], f"{where}.roll", -45.0, 45.0),
    }


def _validate_camera(cam: object, idx: int) -> dict:
    where = f"cameras[{idx}]"
    if not isinstance(cam, dict):
        raise CameraConfigError(f"{where}: 객체여야 합니다")
    for req in ("key", "name", "fov_h_deg"):
        if req not in cam:
            raise CameraConfigError(f"{where}: '{req}'가 필요합니다")
    out = dict(cam)
    out["fov_h_deg"] = _number(cam["fov_h_deg"], f"{where}.fov_h_deg", 0.0, 180.0)
    for opt in ("eye_altitude_m", "tower_height_m"):
        if cam.get(opt) is not None:
            out[opt] = _number(cam[opt], f"{where}.{opt}")
    if cam.get("camera_id") is not None and (isinstance(cam["camera_id"], bool) or not isinstance(cam["camera_id"], int)):
        raise CameraConfigError(f"{where}.camera_id: 정수 또는 null이어야 합니다")
    if cam.get("fixed_pose") is not None:
        out["fixed_pose"] = _pose(cam["fixed_pose"], f"{where}.fixed_pose")
    if cam.get("ptz") is not None:
        ptz = cam["ptz"]
        if not isinstance(ptz, dict):
            raise CameraConfigError(f"{where}.ptz: 객체여야 합니다")
        out_ptz: dict = {}
        if ptz.get("pan_offset_deg") is not None:
            out_ptz["pan_offset_deg"] = _number(ptz["pan_offset_deg"], f"{where}.ptz.pan_offset_deg")
        presets = ptz.get("presets") or {}
        if not isinstance(presets, dict):
            raise CameraConfigError(f"{where}.ptz.presets: 객체여야 합니다")
        out_ptz["presets"] = {str(k): _pose(v, f"{where}.ptz.presets[{k}]") for k, v in presets.items()}
        out["ptz"] = out_ptz
    return out


def load_camera_configs(path: Path | str | None = None) -> list[dict]:
    """설정 파일을 읽어 검증된 카메라 목록 반환, 파일이 없으면 빈 목록"""
    p = Path(path) if path is not None else DEFAULT_CONFIG_PATH
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CameraConfigError(f"{p}: JSON 형식 오류 ({exc})") from exc
    if not isinstance(data, dict) or not isinstance(data.get("cameras"), list):
        raise CameraConfigError(f"{p}: 최상위에 'cameras' 목록이 필요합니다")
    cams = [_validate_camera(c, i) for i, c in enumerate(data["cameras"])]
    for field in ("key", "name", "camera_id"):
        seen = [c.get(field) for c in cams if c.get(field) is not None]
        dup = {v for v in seen if seen.count(v) > 1}
        if dup:
            raise CameraConfigError(f"{p}: '{field}' 중복 {sorted(map(str, dup))}")
    return cams


def find_camera_config(configs: list[dict], camera_id: int | None = None, name: str | None = None) -> dict | None:
    """DB ID가 있으면 ID로, 없으면 이름으로 찾음"""
    if camera_id is not None:
        for c in configs:
            if c.get("camera_id") == camera_id:
                return c
    if name is not None:
        for c in configs:
            if c.get("name") == name:
                return c
    return None
