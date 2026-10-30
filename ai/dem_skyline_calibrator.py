from __future__ import annotations

import math
import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
R_EARTH = 6371008.8
K_REFRACTION = 0.13
FETCH_TRIES = 4
DEFAULT_CACHE_DIR = Path(__file__).resolve().parent / ".dem_cache"


def ll2px(zoom: int, lat: float, lon: float) -> tuple[float, float]:
    """Convert (lat, lon) to Web Mercator global pixel coordinates at a given zoom level."""
    n = 256.0 * (2 ** zoom)
    x = (lon + 180.0) / 360.0 * n
    lat_rad = math.radians(max(-85.05112878, min(85.05112878, lat)))
    y = (1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n
    return x, y


def meters_per_px(zoom: int, lat: float) -> float:
    """Ground resolution (meters per pixel) at a given latitude and zoom level."""
    return 156543.03392804097 * math.cos(math.radians(lat)) / (2 ** zoom)


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two (lat, lon) coordinates."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    return 2.0 * R_EARTH * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def dest_point(lat0: float, lon0: float, brg_deg: float, dist_m: float) -> tuple[float, float]:
    """Spherical trigonometry destination point from (lat0, lon0) along bearing (deg) and distance (m)."""
    la1, lo1 = math.radians(lat0), math.radians(lon0)
    b = math.radians(brg_deg)
    d = dist_m / R_EARTH
    sin_la2 = math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(b)
    la2 = math.asin(max(-1.0, min(1.0, sin_la2)))
    lo2 = lo1 + math.atan2(
        math.sin(b) * math.sin(d) * math.cos(la1),
        math.cos(d) - math.sin(la1) * math.sin(la2),
    )
    return math.degrees(la2), math.degrees(lo2)


def _dest_np(
    lat0: float, lon0: float, brg: np.ndarray, dist: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Vectorized spherical destination coordinates for arrays of bearings (M,) and distances (N,)."""
    la1, lo1 = math.radians(lat0), math.radians(lon0)
    b = np.radians(brg)[:, None]
    d = (dist / R_EARTH)[None, :]
    la2 = np.arcsin(
        np.clip(
            math.sin(la1) * np.cos(d) + math.cos(la1) * np.sin(d) * np.cos(b),
            -1.0,
            1.0,
        )
    )
    lo2 = lo1 + np.arctan2(
        np.sin(b) * np.sin(d) * math.cos(la1),
        np.cos(d) - math.sin(la1) * np.sin(la2),
    )
    return np.degrees(la2), np.degrees(lo2)


def _decode(p: Path) -> np.ndarray | None:
    """Decode a cached AWS Terrarium tile (RGB -> meters above sea level)."""
    try:
        with Image.open(p) as im:
            if im.size != (256, 256):
                return None
            a = np.asarray(im.convert("RGB"), dtype=np.float32)
    except Exception:
        return None
    return a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0


def _fetch(z: int, x: int, y: int, cache: Path) -> np.ndarray | None:
    """Fetch and decode one Terrarium DEM tile with local disk caching."""
    p = cache / f"terrarium_{z}_{x}_{y}.png"
    if p.exists():
        arr = _decode(p)
        if arr is not None:
            return arr
        p.unlink(missing_ok=True)
    tmp = p.with_name(f"{p.name}.{os.getpid()}.{threading.get_ident()}.part")
    url = TILE_URL.format(z=z, x=x, y=y)
    cmd = ["curl", "-q", "-fsS", "-m", "30", "-o", str(tmp), url]
    for k in range(FETCH_TRIES):
        if k:
            time.sleep(2 ** (k - 1))
        r = subprocess.run(cmd, check=False, capture_output=True)
        arr = _decode(tmp) if r.returncode == 0 else None
        if arr is not None:
            os.replace(tmp, p)
            return arr
        tmp.unlink(missing_ok=True)
    return None


class DEM:
    """AWS Terrarium elevation mosaic indexed by Web Mercator pixels with bilinear interpolation."""

    def __init__(
        self,
        center: tuple[float, float],
        radius_m: float = 12000.0,
        zoom: int = 12,
        cache: Path = DEFAULT_CACHE_DIR,
    ):
        cache.mkdir(parents=True, exist_ok=True)
        self.center = center
        self.z = zoom
        mpp = meters_per_px(zoom, center[0])
        cx, cy = ll2px(zoom, center[0], center[1])
        r_px = radius_m / mpp + 256.0
        self.tx0 = int((cx - r_px) // 256)
        self.ty0 = int((cy - r_px) // 256)
        tx1 = int((cx + r_px) // 256)
        ty1 = int((cy + r_px) // 256)
        nx, ny = tx1 - self.tx0 + 1, ty1 - self.ty0 + 1
        if nx * ny > 400:
            raise ValueError(f"Requested DEM area too large ({nx}x{ny} tiles)")

        self.h = np.full((ny * 256, nx * 256), np.nan, dtype=np.float32)
        jobs = [(x, y) for y in range(self.ty0, ty1 + 1) for x in range(self.tx0, tx1 + 1)]
        with ThreadPoolExecutor(max_workers=8) as ex:
            results = list(ex.map(lambda t: _fetch(zoom, t[0], t[1], cache), jobs))

        for (x, y), arr in zip(jobs, results):
            if arr is not None:
                y_slice = slice((y - self.ty0) * 256, (y - self.ty0 + 1) * 256)
                x_slice = slice((x - self.tx0) * 256, (x - self.tx0 + 1) * 256)
                self.h[y_slice, x_slice] = arr

    def sample(self, lat: np.ndarray | float, lon: np.ndarray | float) -> np.ndarray | float:
        """Bilinearly interpolate ground elevation (m) at scalar or array (lat, lon)."""
        is_scalar = np.isscalar(lat) and np.isscalar(lon)
        lat_arr = np.asarray(lat, dtype=np.float64)
        lon_arr = np.asarray(lon, dtype=np.float64)

        n = 256.0 * (2 ** self.z)
        x = (lon_arr + 180.0) / 360.0 * n - self.tx0 * 256.0
        y = (1.0 - np.arcsinh(np.tan(np.radians(lat_arr))) / np.pi) / 2.0 * n - self.ty0 * 256.0

        x0 = np.floor(x).astype(int)
        y0 = np.floor(y).astype(int)
        fx = x - x0
        fy = y - y0

        H, W = self.h.shape
        x0 = np.clip(x0, 0, W - 2)
        y0 = np.clip(y0, 0, H - 2)

        a = self.h[y0, x0]
        b = self.h[y0, x0 + 1]
        c = self.h[y0 + 1, x0]
        d = self.h[y0 + 1, x0 + 1]
        val = (a * (1.0 - fx) + b * fx) * (1.0 - fy) + (c * (1.0 - fx) + d * fx) * fy
        return float(val) if is_scalar else val


def cast_horizon(
    dem: DEM,
    at: tuple[float, float],
    eye_alt: float,
    azimuths: np.ndarray,
    rng: float = 12000.0,
    near: float = 80.0,
    n: int = 500,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Compute elevation angles along each azimuth with Earth curvature & atmospheric refraction.
    Returns:
      - hor: (M,) maximum horizon elevation angle (deg) per azimuth
      - ang: (M, N) elevation angle matrix
      - dist: (N,) log-spaced sample distances (m)
    """
    dist = near * (rng / near) ** (np.arange(n) / (n - 1))
    lat, lon = _dest_np(at[0], at[1], azimuths, dist)
    h = dem.sample(lat, lon)
    drop = (dist ** 2) / (2.0 * R_EARTH) * (1.0 - K_REFRACTION)
    ang = np.degrees(np.arctan2(h - drop[None, :] - eye_alt, dist[None, :]))
    ang = np.nan_to_num(ang, nan=-90.0)
    hor = ang.max(axis=1)
    return hor, ang, dist


def _sky_edge(
    prof: np.ndarray, ymin: int, ymax: int, k: int = 6, drop: float = 12.0, hold: int = 10
) -> int | None:
    """Detect the sky-to-mountain brightness drop row in a single column profile."""
    n = len(prof)
    cs = np.concatenate([[0.0], np.cumsum(prof, dtype=np.float64)])
    y = np.arange(max(ymin, k), min(ymax, n - k - hold))
    if y.size == 0:
        return None
    above = (cs[y] - cs[y - k]) / k
    below = (cs[y + k] - cs[y]) / k
    held = (cs[y + k + hold] - cs[y + k]) / hold
    ok = (above - below >= drop) & (above - held >= drop)
    if not ok.any():
        return None
    y0 = int(y[np.argmax(ok)])
    yy = np.arange(max(k, y0 - k), min(n - k, y0 + k + 1))
    g = (cs[yy] - cs[yy - k]) / k - (cs[yy + k] - cs[yy]) / k
    return int(yy[np.argmax(g)])


def filter_ridge_outliers(
    ridge_pts: list[tuple[float, float]] | np.ndarray,
    window: int = 5,
    mad_thresh: float = 2.5,
) -> np.ndarray:
    """
    Apply moving median filtering and MAD (Median Absolute Deviation) outlier rejection
    to remove local tree-branch, pole, or smoke spikes on the extracted skyline ridge.
    """
    pts = np.asarray(ridge_pts, dtype=np.float64)
    if len(pts) < 5:
        return pts

    xs, ys = pts[:, 0], pts[:, 1]
    half = window // 2
    med_y = np.empty_like(ys)
    for i in range(len(ys)):
        lo = max(0, i - half)
        hi = min(len(ys), i + half + 1)
        med_y[i] = np.median(ys[lo:hi])

    abs_dev = np.abs(ys - med_y)
    mad = max(1.0, float(np.median(abs_dev)) * 1.4826)
    inliers = abs_dev <= (mad_thresh * mad)

    # Replace local spike outliers with the moving median value and keep strong inliers
    clean_y = np.where(inliers, ys, med_y)
    return np.column_stack([xs, clean_y])


class SkylineCalibrator:
    """
    Stage 1 Calibrator: Aligns observed skyline ridge points with AWS Terrarium DEM
    synthetic horizon to estimate and correct camera PTZ mechanical errors (dPan, dTilt, Roll).
    """

    def __init__(self, dem: DEM):
        self.dem = dem

    @staticmethod
    def focal_px(width: float, fov_h_deg: float) -> float:
        return (width / 2.0) / math.tan(math.radians(fov_h_deg / 2.0))

    def synthesize_skyline_pixels(
        self,
        cam_lat: float,
        cam_lon: float,
        eye_alt: float,
        true_pan: float,
        true_tilt: float,
        true_roll: float,
        width: int = 1920,
        height: int = 1080,
        fov_h: float = 60.0,
        step_px: int = 20,
        noise_std_px: float = 0.0,
        outlier_ratio: float = 0.0,
        seed: int = 42,
    ) -> np.ndarray:
        """
        Project the true DEM skyline onto image pixel coordinates (x, y) for a camera pose.
        Optionally injects sensor pixel noise and tree-branch outliers for benchmark testing.
        """
        f = self.focal_px(width, fov_h)
        cx, cy = width / 2.0, height / 2.0
        xs = np.arange(80, width - 80, step_px, dtype=np.float64)
        r_off_deg = np.degrees(np.arctan((xs - cx) / f))

        az_query = (true_pan + r_off_deg) % 360.0
        hor_deg, _, _ = cast_horizon(self.dem, (cam_lat, cam_lon), eye_alt, az_query)

        # Pinhole projection with camera pitch (true_tilt) and roll (true_roll)
        # Elevation angle relative to camera optical axis = hor_deg - true_tilt
        rel_el_rad = np.radians(hor_deg - true_tilt)
        roll_rad = math.radians(true_roll)
        ys = cy - f * np.tan(rel_el_rad) + math.tan(roll_rad) * (xs - cx)

        if noise_std_px > 0.0 or outlier_ratio > 0.0:
            rng = np.random.default_rng(seed)
            if noise_std_px > 0.0:
                ys = ys + rng.normal(0.0, noise_std_px, size=ys.shape)
            if outlier_ratio > 0.0:
                n_out = int(len(ys) * outlier_ratio)
                if n_out > 0:
                    out_idx = rng.choice(len(ys), size=n_out, replace=False)
                    # Simulate tree branches or utility poles sticking up into the sky
                    ys[out_idx] -= rng.uniform(15.0, 45.0, size=n_out)

        valid = (ys >= 0) & (ys < height)
        return np.column_stack([xs[valid], ys[valid]])

    def calibrate_ptz(
        self,
        cam_lat: float,
        cam_lon: float,
        eye_alt: float,
        init_pan: float,
        init_tilt: float,
        ridge_pts: list[tuple[float, float]] | np.ndarray,
        width: int = 1920,
        height: int = 1080,
        fov_h: float = 60.0,
        pan_search_window: float = 4.0,
        az_step: float = 0.05,
        cc_max: float = 4.0,
        roll_max_deg: float = 3.0,
    ) -> dict:
        """
        Solve for the calibrated (pan, tilt, roll) around (init_pan, init_tilt)
        by matching filtered skyline ridge points against the DEM horizon via Least Squares.
        """
        clean_pts = filter_ridge_outliers(ridge_pts)
        if len(clean_pts) < 3:
            return {
                "pan": init_pan,
                "tilt": init_tilt,
                "roll": 0.0,
                "d_pan": 0.0,
                "d_tilt": 0.0,
                "rms_deg": float("nan"),
            }

        RX, RY = clean_pts[:, 0], clean_pts[:, 1]
        f = self.focal_px(width, fov_h)
        cx, cy = width / 2.0, height / 2.0

        # Horizontal bearing offsets and observed elevation angles assuming init_tilt
        r_off = np.degrees(np.arctan((RX - cx) / f))
        r_el = init_tilt + np.degrees(np.arctan((cy - RY) / f))

        # Precompute fine DEM horizon over the visible sector + search window
        min_off = float(r_off.min()) - pan_search_window - 1.0
        max_off = float(r_off.max()) + pan_search_window + 1.0
        rel_grid = np.arange(min_off, max_off + az_step, az_step)
        az_grid = (init_pan + rel_grid) % 360.0
        hor_grid, _, _ = cast_horizon(self.dem, (cam_lat, cam_lon), eye_alt, az_grid)

        cand_dpans = np.arange(-pan_search_window, pan_search_window + 1e-6, az_step)
        # Interpolate DEM horizon at (d_pan + r_off) for all candidate d_pans
        query_rel = cand_dpans[:, None] + r_off[None, :]
        hor_matrix = np.interp(query_rel, rel_grid, hor_grid)

        # Residual before tilt/roll correction: diff = DEM_horizon - observed_elevation
        diff = hor_matrix - r_el[None, :]

        roll_max_tan = math.tan(math.radians(roll_max_deg))
        oc = r_off - r_off.mean()
        oc_denom = float((oc ** 2).sum())

        # Pass 1: Initial Linear Least Squares for roll slope (rr) and tilt offset (cc)
        dmean = diff.mean(axis=1)
        if roll_max_deg > 0.0 and oc_denom > 1e-6:
            rr = np.clip(
                ((diff - dmean[:, None]) * oc[None, :]).sum(axis=1) / oc_denom,
                -roll_max_tan,
                roll_max_tan,
            )
            cc = np.clip(dmean - rr * r_off.mean(), -cc_max, cc_max)
        else:
            rr = np.zeros(len(cand_dpans))
            cc = np.clip(np.median(diff, axis=1), -cc_max, cc_max)

        res = diff - cc[:, None] - rr[:, None] * r_off[None, :]

        # Pass 2: Robust IRLS / Trimmed Least Squares (ignore top 15% residual outliers per heading)
        q85 = np.quantile(np.abs(res), 0.85, axis=1, keepdims=True)
        mask = np.abs(res) <= np.maximum(q85, 0.05)
        w = mask.astype(np.float64)
        w_sum = np.maximum(w.sum(axis=1, keepdims=True), 1.0)
        w_r_mean = (w * r_off[None, :]).sum(axis=1, keepdims=True) / w_sum
        w_d_mean = (w * diff).sum(axis=1, keepdims=True) / w_sum
        w_oc = r_off[None, :] - w_r_mean
        w_denom = np.maximum((w * (w_oc ** 2)).sum(axis=1), 1e-6)

        if roll_max_deg > 0.0:
            rr = np.clip(
                (w * (diff - w_d_mean) * w_oc).sum(axis=1) / w_denom,
                -roll_max_tan,
                roll_max_tan,
            )
        cc = np.clip(
            w_d_mean[:, 0] - rr * w_r_mean[:, 0],
            -cc_max,
            cc_max,
        )

        res_clean = diff - cc[:, None] - rr[:, None] * r_off[None, :]
        rms = np.sqrt((w * (res_clean ** 2)).sum(axis=1) / w_sum[:, 0])

        best_k = int(np.argmin(rms))
        best_dpan = float(cand_dpans[best_k])
        best_dtilt = float(cc[best_k])
        best_roll = math.degrees(math.atan(float(rr[best_k])))

        return {
            "pan": (init_pan + best_dpan) % 360.0,
            "tilt": init_tilt + best_dtilt,
            "roll": best_roll,
            "d_pan": best_dpan,
            "d_tilt": best_dtilt,
            "rms_deg": float(rms[best_k]),
        }
