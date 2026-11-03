"""
카메라 보정 도구 (#58, docs/Camera_Calibration.md)

- 보정 작업 파일(카메라·화면·랜드마크)로 화각과 화면별 자세를 구해 ai/config/cameras.json 항목(ADR 0018) 생성
- 카메라 위치(위경도)는 DB 값으로 고정, 추정하지 않음
"""
from __future__ import annotations

import json
import math
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LANDMARK_USES = ("fit", "val")


class CalibrationJobError(ValueError):
    """보정 작업 파일 형식 오류"""


def _num(value: object, where: str, lo: float | None = None, hi: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise CalibrationJobError(f"{where}: 유한한 숫자여야 합니다 ({value!r})")
    v = float(value)
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        raise CalibrationJobError(f"{where}: {lo} ~ {hi} 범위여야 합니다 ({v})")
    return v


def _require(d: dict, keys: tuple[str, ...], where: str) -> None:
    for k in keys:
        if k not in d:
            raise CalibrationJobError(f"{where}: '{k}'가 필요합니다")


def load_calibration_job(path: Path | str, base_dir: Path | str | None = None) -> dict:
    """보정 작업 파일을 읽고 검증, 프레임 경로는 base_dir(기본: 저장소 루트) 기준 절대 경로로 변환"""
    p = Path(path)
    base = Path(base_dir) if base_dir is not None else REPO_ROOT
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CalibrationJobError(f"{p}: 읽을 수 없습니다 ({exc})") from exc
    if not isinstance(data, dict):
        raise CalibrationJobError(f"{p}: 최상위는 객체여야 합니다")
    _require(data, ("camera", "views"), "작업 파일")

    cam = data["camera"]
    if not isinstance(cam, dict):
        raise CalibrationJobError("camera: 객체여야 합니다")
    _require(cam, ("key", "name", "lat", "lon"), "camera")
    camera = {
        "key": str(cam["key"]),
        "name": str(cam["name"]),
        "camera_id": cam.get("camera_id"),
        "lat": _num(cam["lat"], "camera.lat", -90.0, 90.0),
        "lon": _num(cam["lon"], "camera.lon", -180.0, 180.0),
        "tower_height_m": _num(cam.get("tower_height_m", 15.0), "camera.tower_height_m", 0.0, 500.0),
    }

    fov = data.get("fov_search_deg", [35.0, 75.0])
    if not isinstance(fov, list) or len(fov) != 2:
        raise CalibrationJobError("fov_search_deg: [최소, 최대] 형식이어야 합니다")
    fov_lo, fov_hi = _num(fov[0], "fov_search_deg[0]", 1.0, 179.0), _num(fov[1], "fov_search_deg[1]", 1.0, 179.0)
    if fov_lo >= fov_hi:
        raise CalibrationJobError("fov_search_deg: 최소가 최대보다 작아야 합니다")
    fov_step = _num(data.get("fov_step_deg", 1.0), "fov_step_deg", 0.1, 20.0)

    views_raw = data["views"]
    if not isinstance(views_raw, list) or not views_raw:
        raise CalibrationJobError("views: 화면이 1개 이상 필요합니다")
    views = []
    for i, v in enumerate(views_raw):
        where = f"views[{i}]"
        if not isinstance(v, dict):
            raise CalibrationJobError(f"{where}: 객체여야 합니다")
        _require(v, ("id", "frame"), where)
        view = {"id": str(v["id"]), "frame": base / str(v["frame"]), "preset": v.get("preset")}
        if v.get("label_pan") is not None:
            view["label_pan"] = _num(v["label_pan"], f"{where}.label_pan")
        views.append(view)
    ids = [v["id"] for v in views]
    if len(set(ids)) != len(ids):
        raise CalibrationJobError(f"views: id 중복 {sorted({i for i in ids if ids.count(i) > 1})}")

    landmarks = []
    for i, lm in enumerate(data.get("landmarks") or []):
        where = f"landmarks[{i}]"
        if not isinstance(lm, dict):
            raise CalibrationJobError(f"{where}: 객체여야 합니다")
        _require(lm, ("name", "lat", "lon", "view", "px", "use"), where)
        if str(lm["view"]) not in ids:
            raise CalibrationJobError(f"{where}.view: 없는 화면 {lm['view']!r}")
        if lm["use"] not in LANDMARK_USES:
            raise CalibrationJobError(f"{where}.use: {LANDMARK_USES} 중 하나여야 합니다")
        px = lm["px"]
        if not isinstance(px, list) or len(px) != 2:
            raise CalibrationJobError(f"{where}.px: [x, y] 형식이어야 합니다")
        landmarks.append({
            "name": str(lm["name"]),
            "lat": _num(lm["lat"], f"{where}.lat", -90.0, 90.0),
            "lon": _num(lm["lon"], f"{where}.lon", -180.0, 180.0),
            "height_m": _num(lm.get("height_m", 0.0), f"{where}.height_m", 0.0, 500.0),
            "view": str(lm["view"]),
            "px": (_num(px[0], f"{where}.px[0]"), _num(px[1], f"{where}.px[1]")),
            "use": lm["use"],
        })

    return {
        "path": p,
        "camera": camera,
        "fov_search_deg": (fov_lo, fov_hi),
        "fov_step_deg": fov_step,
        "views": views,
        "landmarks": landmarks,
    }


# ---------------------------------------------------------------------------
# 보정 계산
# ---------------------------------------------------------------------------
FOV_INTERVAL_RATIO = 1.10  # 최소 오차의 10% 이내 화각을 불확실성 구간으로 보고
FOV_ILL_CONSTRAINED_SPAN_DEG = 6.0
PAN_OFFSET_SPREAD_LIMIT_DEG = 3.0


def _load_ridges(job: dict, extractor) -> tuple[dict, list[str]]:
    import numpy as np
    from PIL import Image

    ridges, warnings = {}, []
    for view in job["views"]:
        try:
            with Image.open(view["frame"]) as img:
                frame = np.asarray(img.convert("RGB"))
        except OSError:
            warnings.append(f"VIEW_FAILED:{view['id']}:FRAME_NOT_FOUND")
            continue
        res = extractor.extract(frame)
        if not res["is_valid"]:
            warnings.append(f"VIEW_FAILED:{view['id']}:RIDGE_NOT_DETECTED")
            continue
        height, width = frame.shape[:2]
        ridges[view["id"]] = {"pts": res["ridge_pts"], "width": width, "height": height}
    return ridges, warnings


def _ridge_rms_deg(provider, xs, ys, pose, width, height, fov) -> float:
    import numpy as np

    from ai.camera_model import pixel_to_direction

    az, el = pixel_to_direction(xs, ys, *pose, width, height, fov)
    az_ext = np.append(provider.az_grid, 360.0)
    sky_ext = np.append(provider.skyline_el_deg, provider.skyline_el_deg[0])
    return float(np.sqrt(np.mean((el - np.interp(az % 360.0, az_ext, sky_ext)) ** 2)))


def _fit_view(provider, ridge: dict, fov: float, seed: tuple[float, float]) -> dict:
    """화각 fov에서 한 화면의 자세를 정식 회전 모델로 추정 (seed Pan 주변 탐색)"""
    import numpy as np

    xs = ridge["pts"][:, 0]
    ys = provider._clean_ridge_y(ridge["pts"][:, 1])
    w, h = ridge["width"], ridge["height"]
    seed_pan, seed_tilt = seed
    P, T, R, rms = provider._fit_pose_exact(
        xs, ys, seed_pan + np.arange(-10.0, 10.0 + 1e-6, 0.5), np.arange(-2.5, 2.5 + 1e-6, 0.5), seed_tilt, w, h, fov
    )
    k = int(np.argmin(rms))
    P, T, R, rms = provider._fit_pose_exact(
        xs, ys, P[k] + np.arange(-0.5, 0.5 + 1e-6, 0.05),
        np.clip(R[k] + np.arange(-0.5, 0.5 + 1e-6, 0.1), -2.5, 2.5), T[k], w, h, fov,
    )
    k = int(np.argmin(rms))
    pose = (float(P[k]) % 360.0, float(T[k]), float(R[k]))
    return {"pan": pose[0], "tilt": pose[1], "roll": pose[2],
            "rms_deg": _ridge_rms_deg(provider, xs, ys, pose, w, h, fov) if np.isfinite(rms[k]) else 999.0}


def calibrate_camera(job: dict, provider=None, extractor=None) -> dict:
    """
    보정 작업으로 화각과 화면별 자세를 추정 (docs/Camera_Calibration.md 절차)
    반환: fov_h_deg, fov_interval, fov_curve, views, pan_offset, warnings
    """
    import numpy as np

    from ai.dem_skyline_engine import DEMProvider
    from ai.ridge_detector import SkylineExtractor

    cam = job["camera"]
    if provider is None:
        provider = DEMProvider(cam_lat=cam["lat"], cam_lon=cam["lon"], tower_height_m=cam["tower_height_m"])
    extractor = extractor or SkylineExtractor()
    ridges, warnings = _load_ridges(job, extractor)

    fov_lo, fov_hi = job["fov_search_deg"]
    fovs = np.arange(fov_lo, fov_hi + 1e-6, job["fov_step_deg"])
    fov_mid = float(fovs[len(fovs) // 2])

    # Pan 시작값: 기준 화각부터 가까운 순서로 360° 역산, 처음 통과한 자세 사용
    seeds = {}
    for vid, ridge in ridges.items():
        for fov in sorted(fovs, key=lambda f: abs(f - fov_mid)):
            b = provider.estimate_blind_ptz(ridge["pts"], ridge["width"], ridge["height"], float(fov))
            if b["status"] == "OK":
                seeds[vid] = (float(b["pan"]), float(b["tilt"]))
                break
        if vid not in seeds:
            warnings.append(f"VIEW_FAILED:{vid}:POSE_NOT_FOUND")
    if not seeds:
        return {"status": "FAILED", "fov_h_deg": None, "fov_interval": None, "fov_curve": [],
                "views": {}, "pan_offset": None, "warnings": warnings}

    curve, fits = [], {}
    for fov in fovs:
        per_view = {vid: _fit_view(provider, ridges[vid], float(fov), seed) for vid, seed in seeds.items()}
        cost = float(np.mean([v["rms_deg"] ** 2 for v in per_view.values()]))
        curve.append((float(fov), cost))
        fits[float(fov)] = per_view

    best_fov, best_cost = min(curve, key=lambda c: c[1])
    inside = [f for f, c in curve if c <= best_cost * FOV_INTERVAL_RATIO + 1e-12]
    interval = (min(inside), max(inside))

    views = {}
    for view in job["views"]:
        if view["id"] in fits[best_fov]:
            views[view["id"]] = {**fits[best_fov][view["id"]], "preset": view.get("preset"),
                                 "label_pan": view.get("label_pan")}

    offsets = [((v["pan"] - v["label_pan"]) % 360.0) for v in views.values() if v.get("label_pan") is not None]
    pan_offset = None
    if offsets:
        pan_offset = {"median": float(np.median(offsets)), "min": float(min(offsets)), "max": float(max(offsets))}

    return {
        "status": "OK",
        "fov_h_deg": best_fov,
        "fov_interval": interval,
        "fov_curve": curve,
        "views": views,
        "pan_offset": pan_offset,
        "warnings": warnings,
    }
