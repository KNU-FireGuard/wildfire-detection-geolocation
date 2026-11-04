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


def _landmark_vectors(provider, landmarks: list[dict]):
    """카메라 눈 위치에서 랜드마크까지의 ENU 벡터 (수 km 이내 평면 근사)"""
    import numpy as np

    m_lat = 111320.0
    m_lon = 111320.0 * math.cos(math.radians(provider.cam_lat))
    rows = []
    for lm in landmarks:
        dz = float(provider.get_elevation(lm["lat"], lm["lon"])) + lm["height_m"] - provider.eye_alt
        rows.append(((lm["lon"] - provider.cam_lon) * m_lon, (lm["lat"] - provider.cam_lat) * m_lat, dz))
    return np.array(rows, dtype=np.float64).reshape(-1, 3)


def _landmark_errors_deg(vecs, px, P, T, R, width, height, fov):
    """후보 자세(K개)마다 랜드마크(L개) 투영 위치와 표시 픽셀의 각도 오차 (L, K), 카메라 뒤쪽은 90°"""
    import numpy as np

    from ai.camera_model import camera_basis_batch, focal_length_px

    f = focal_length_px(width, fov)
    fwd, right, up = camera_basis_batch(P, T, R)
    z = vecs @ fwd.T
    zs = np.where(z > 1e-6, z, np.nan)
    x = width / 2.0 + f * (vecs @ right.T) / zs
    y = height / 2.0 - f * (vecs @ up.T) / zs
    err_px = np.hypot(x - px[:, 0:1], y - px[:, 1:2])
    return np.where(np.isfinite(err_px), np.degrees(np.arctan(err_px / f)), 90.0)


def _fit_view(provider, ridge: dict, fov: float, seed: tuple[float, float], lm_vecs=None, lm_px=None) -> dict:
    """
    화각 fov에서 한 화면의 자세를 정식 회전 모델로 추정 (seed Pan 주변 탐색)
    보정용 랜드마크가 있으면 후보 점수 = 능선 잔차² + 랜드마크 각도 오차² 평균
    """
    import numpy as np

    from ai.camera_model import focal_length_px

    xs = ridge["pts"][:, 0]
    ys = provider._clean_ridge_y(ridge["pts"][:, 1])
    w, h = ridge["width"], ridge["height"]
    f = focal_length_px(w, fov)
    has_lm = lm_vecs is not None and len(lm_vecs) > 0

    def score(P, T, R, rms):
        s = np.degrees(np.arctan(rms / f)) ** 2
        if has_lm:
            s = s + np.mean(_landmark_errors_deg(lm_vecs, lm_px, P, T, R, w, h, fov) ** 2, axis=0)
        return s

    seed_pan, seed_tilt = seed
    P, T, R, rms = provider._fit_pose_exact(
        xs, ys, seed_pan + np.arange(-10.0, 10.0 + 1e-6, 0.5), np.arange(-2.5, 2.5 + 1e-6, 0.5), seed_tilt, w, h, fov
    )
    k = int(np.argmin(score(P, T, R, rms)))
    P, T, R, rms = provider._fit_pose_exact(
        xs, ys, P[k] + np.arange(-0.5, 0.5 + 1e-6, 0.05),
        np.clip(R[k] + np.arange(-0.5, 0.5 + 1e-6, 0.1), -2.5, 2.5), T[k], w, h, fov,
    )
    k = int(np.argmin(score(P, T, R, rms)))
    pose = (float(P[k]) % 360.0, float(T[k]), float(R[k]))
    out = {"pan": pose[0], "tilt": pose[1], "roll": pose[2],
           "rms_deg": _ridge_rms_deg(provider, xs, ys, pose, w, h, fov) if np.isfinite(rms[k]) else 999.0,
           "landmark_errors_deg": []}
    if has_lm:
        out["landmark_errors_deg"] = [float(e) for e in _landmark_errors_deg(
            lm_vecs, lm_px, np.array([P[k]]), np.array([T[k]]), np.array([R[k]]), w, h, fov)[:, 0]]
    return out


def _validation_report(provider, job: dict, views: dict, ridges: dict, fov: float) -> list[dict]:
    """검증용(val) 랜드마크: 최종 자세에서 표시 픽셀 광선과 실제 방향의 각도 오차, 옆 방향 거리 오차(m)"""
    import numpy as np

    from ai.camera_model import pixel_to_direction

    out = []
    for lm in job["landmarks"]:
        if lm["use"] != "val" or lm["view"] not in views:
            continue
        v, r = views[lm["view"]], ridges[lm["view"]]
        vec = _landmark_vectors(provider, [lm])[0]
        dist_h = float(math.hypot(vec[0], vec[1]))
        az_true = math.degrees(math.atan2(vec[0], vec[1])) % 360.0
        el_true = math.degrees(math.atan2(vec[2], dist_h))
        az_px, el_px = pixel_to_direction(lm["px"][0], lm["px"][1], v["pan"], v["tilt"], v["roll"],
                                          r["width"], r["height"], fov)
        d_az = (float(az_px) - az_true + 180.0) % 360.0 - 180.0
        d_el = float(el_px) - el_true
        out.append({
            "name": lm["name"],
            "view": lm["view"],
            "error_deg": float(np.hypot(d_az * math.cos(math.radians(el_true)), d_el)),
            "azimuth_error_deg": d_az,
            "elevation_error_deg": d_el,
            "distance_m": dist_h,
            "lateral_m": dist_h * math.radians(d_az),
        })
    return out


POSITION_SPREAD_LIMIT_DEG = 60.0
LANDMARK_RESIDUAL_LIMIT_DEG = 1.0  # 보정용 랜드마크 평균 각도 오차가 이보다 크면 모델(특히 카메라 위치)과 불일치


def fov_interval(curve: list[tuple[float, float]]) -> tuple[tuple[float, float], bool]:
    """최소 오차의 10% 이내 화각 구간과, 구간 폭이 6° 이상인지(FOV_ILL_CONSTRAINED) 반환"""
    best_cost = min(c for _, c in curve)
    inside = [f for f, c in curve if c <= best_cost * FOV_INTERVAL_RATIO + 1e-12]
    interval = (min(inside), max(inside))
    return interval, (interval[1] - interval[0]) >= FOV_ILL_CONSTRAINED_SPAN_DEG


def _azimuth_spread_deg(azimuths: list[float]) -> float:
    """방위각 집합이 차지하는 원 위의 범위 (가장 큰 빈 간격을 뺀 나머지)"""
    if len(azimuths) < 2:
        return 0.0
    a = sorted(x % 360.0 for x in azimuths)
    gaps = [a[i + 1] - a[i] for i in range(len(a) - 1)] + [a[0] + 360.0 - a[-1]]
    return 360.0 - max(gaps)


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

    # 보정용(fit) 랜드마크만 계산에 사용, 검증용(val)은 여기서 쓰지 않음 (순환 검증 방지)
    fit_lms = {vid: [lm for lm in job["landmarks"] if lm["use"] == "fit" and lm["view"] == vid] for vid in seeds}
    for lm in job["landmarks"]:
        if lm["use"] == "fit" and lm["view"] not in seeds:
            warnings.append(f"LANDMARK_IGNORED:{lm['name']}:VIEW_FAILED")
    lm_arrays = {
        vid: (_landmark_vectors(provider, lms), np.array([lm["px"] for lm in lms], dtype=np.float64).reshape(-1, 2))
        for vid, lms in fit_lms.items() if lms
    }

    curve, fits = [], {}
    for fov in fovs:
        per_view = {
            vid: _fit_view(provider, ridges[vid], float(fov), seed, *lm_arrays.get(vid, (None, None)))
            for vid, seed in seeds.items()
        }
        cost = float(np.mean([v["rms_deg"] ** 2 for v in per_view.values()]))
        lm_errs = [e for v in per_view.values() for e in v["landmark_errors_deg"]]
        if lm_errs:
            cost += float(np.mean(np.square(lm_errs)))
        curve.append((float(fov), cost))
        fits[float(fov)] = per_view

    best_fov, best_cost = min(curve, key=lambda c: c[1])
    interval, ill_constrained = fov_interval(curve)
    if ill_constrained:
        warnings.append("FOV_ILL_CONSTRAINED")
    if best_fov in (float(fovs[0]), float(fovs[-1])):
        # 최적 화각이 탐색 범위 끝에 붙으면 진짜 최적이 범위 밖에 있을 수 있음
        warnings.append("FOV_AT_SEARCH_BOUNDARY")

    views = {}
    for view in job["views"]:
        if view["id"] in fits[best_fov]:
            views[view["id"]] = {**fits[best_fov][view["id"]], "preset": view.get("preset"),
                                 "label_pan": view.get("label_pan")}

    offsets = [((v["pan"] - v["label_pan"]) % 360.0) for v in views.values() if v.get("label_pan") is not None]
    pan_offset = None
    if offsets:
        pan_offset = {"median": float(np.median(offsets)), "min": float(min(offsets)), "max": float(max(offsets))}
        if pan_offset["max"] - pan_offset["min"] > PAN_OFFSET_SPREAD_LIMIT_DEG:
            warnings.append("PAN_OFFSET_INCONSISTENT")

    all_fit = [lm for lms in fit_lms.values() for lm in lms]
    if not all_fit:
        warnings.append("NO_LANDMARKS")
    else:
        vecs = _landmark_vectors(provider, all_fit)
        azimuths = [math.degrees(math.atan2(v[0], v[1])) for v in vecs]
        if _azimuth_spread_deg(azimuths) < POSITION_SPREAD_LIMIT_DEG:
            warnings.append("POSITION_UNCONSTRAINED")
        fit_errs = [e for v in views.values() for e in v["landmark_errors_deg"]]
        if fit_errs and float(np.mean(fit_errs)) > LANDMARK_RESIDUAL_LIMIT_DEG:
            warnings.append("LANDMARK_RESIDUAL_HIGH")
    if not any(lm["use"] == "val" for lm in job["landmarks"]):
        warnings.append("NO_VALIDATION_LANDMARKS")

    return {
        "status": "OK",
        "fov_h_deg": best_fov,
        "fov_interval": interval,
        "fov_curve": curve,
        "views": views,
        "pan_offset": pan_offset,
        "fit_landmarks": [
            {"name": lm["name"], "view": vid, "error_deg": err}
            for vid, lms in fit_lms.items() if vid in views
            for lm, err in zip(lms, views[vid]["landmark_errors_deg"])
        ],
        "validation": _validation_report(provider, job, views, ridges, best_fov),
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# 설정 후보 생성·적용 (ADR 0018)
# ---------------------------------------------------------------------------
def build_config_entry(job: dict, result: dict) -> dict:
    """보정 결과를 ai/config/cameras.json 항목으로 변환, #57 로더 검증을 통과한 항목만 반환"""
    from datetime import date

    from ai.camera_config import CameraConfigError, _validate_camera

    if result.get("status") != "OK" or not result.get("views"):
        raise CalibrationJobError("보정이 실패해 설정 항목을 만들 수 없습니다")
    cam = job["camera"]
    entry: dict = {"key": cam["key"], "name": cam["name"], "camera_id": cam.get("camera_id"),
                   "fov_h_deg": round(float(result["fov_h_deg"]), 2)}

    def pose(v: dict) -> dict:
        return {"pan": round(v["pan"], 2), "tilt": round(v["tilt"], 2), "roll": round(v["roll"], 2)}

    presets = {v["preset"]: pose(v) for v in result["views"].values() if v.get("preset")}
    fixed = [v for v in result["views"].values() if not v.get("preset")]
    if presets:
        entry["ptz"] = {"presets": presets}
        if result.get("pan_offset"):
            entry["ptz"]["pan_offset_deg"] = round(result["pan_offset"]["median"], 2)
    elif fixed:
        entry["fixed_pose"] = pose(fixed[0])

    validation = result.get("validation") or []
    entry["provenance"] = f"카메라 보정 도구(#58), 작업 파일 {Path(job['path']).name}, {date.today().isoformat()}"
    entry["uncertainty"] = {
        "fov_interval_deg": list(result["fov_interval"]),
        "pan_offset_range_deg": [round(result["pan_offset"]["min"], 2), round(result["pan_offset"]["max"], 2)]
        if result.get("pan_offset") else None,
        "validation_max_error_deg": round(max(v["error_deg"] for v in validation), 3) if validation else None,
        "warnings": list(result["warnings"]),
    }
    try:
        _validate_camera(entry, 0)
    except CameraConfigError as exc:
        raise CalibrationJobError(f"생성한 설정 항목이 형식 검증을 통과하지 못했습니다: {exc}") from exc
    return entry


def write_config_candidate(entry: dict, path: Path | str) -> Path:
    """설정 후보를 별도 파일로 저장 (ai/config/cameras.json에는 반영하지 않음)"""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"version": 1, "cameras": [entry]}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return p


def apply_config_entry(entry: dict, config_path: Path | str | None = None) -> Path:
    """같은 key 항목을 교체(없으면 추가)해 설정 파일에 반영, 전체 검증 실패 시 원래 내용 복원"""
    from ai.camera_config import DEFAULT_CONFIG_PATH, CameraConfigError, load_camera_configs

    p = Path(config_path) if config_path is not None else DEFAULT_CONFIG_PATH
    original = p.read_text(encoding="utf-8") if p.exists() else None
    data = json.loads(original) if original else {"version": 1, "cameras": []}
    cams = [c for c in data.get("cameras", []) if c.get("key") != entry["key"]]
    cams.append(entry)
    data["cameras"] = cams
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        load_camera_configs(p)
    except CameraConfigError:
        if original is None:
            p.unlink()
        else:
            p.write_text(original, encoding="utf-8")
        raise
    return p
