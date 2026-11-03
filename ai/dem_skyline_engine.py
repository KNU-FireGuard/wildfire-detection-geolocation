from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

try:
    from ai.camera_model import camera_basis_batch, direction_to_pixel, direction_vectors, focal_length_px, pixel_to_direction
except ImportError:
    from camera_model import camera_basis_batch, direction_to_pixel, direction_vectors, focal_length_px, pixel_to_direction

try:
    from scipy.interpolate import RegularGridInterpolator
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False

    class RegularGridInterpolator:  # type: ignore[no-redef]
        """
        Pure-NumPy drop-in fallback for scipy.interpolate.RegularGridInterpolator
        performing exact 2D bilinear interpolation on a regular (lat, lon) grid.
        """

        def __init__(
            self,
            points: tuple[np.ndarray, np.ndarray],
            values: np.ndarray,
            method: str = "linear",
            bounds_error: bool = False,
            fill_value: float | None = None,
        ):
            self.lat_grid = np.asarray(points[0], dtype=np.float64)
            self.lon_grid = np.asarray(points[1], dtype=np.float64)
            self.values = np.asarray(values, dtype=np.float64)
            self.bounds_error = bounds_error
            self.fill_value = fill_value

        def __call__(self, xi: np.ndarray | list | tuple) -> np.ndarray:
            pts = np.asarray(xi, dtype=np.float64)
            single = pts.ndim == 1
            if single:
                pts = pts[None, :]

            lats = pts[:, 0]
            lons = pts[:, 1]

            n_lat = len(self.lat_grid)
            n_lon = len(self.lon_grid)

            lat_min, lat_max = self.lat_grid[0], self.lat_grid[-1]
            lon_min, lon_max = self.lon_grid[0], self.lon_grid[-1]

            u = (lats - lat_min) / (lat_max - lat_min) * (n_lat - 1)
            v = (lons - lon_min) / (lon_max - lon_min) * (n_lon - 1)

            u = np.clip(u, 0.0, n_lat - 1.000001)
            v = np.clip(v, 0.0, n_lon - 1.000001)

            i0 = np.floor(u).astype(int)
            j0 = np.floor(v).astype(int)
            du = u - i0
            dv = v - j0

            v00 = self.values[i0, j0]
            v01 = self.values[i0, j0 + 1]
            v10 = self.values[i0 + 1, j0]
            v11 = self.values[i0 + 1, j0 + 1]

            interp = (
                v00 * (1.0 - du) * (1.0 - dv)
                + v01 * (1.0 - du) * dv
                + v10 * du * (1.0 - dv)
                + v11 * du * dv
            )
            return interp[0] if single else interp


OPEN_METEO_URL = "https://api.open-meteo.com/v1/elevation"
TERRARIUM_TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
R_EARTH = 6371008.8
K_REFRACTION = 0.13
GACHANG_CAM_LAT = 35.791037
GACHANG_CAM_LON = 128.591184
DEFAULT_NPZ_PATH = Path(__file__).resolve().parent / "gachang_dem.npz"
DEFAULT_TILE_CACHE_DIR = Path(__file__).resolve().parent / ".dem_cache"

# DEM grid provenance recorded in .npz caches
DEM_SOURCE_TERRARIUM = "terrarium"  # AWS Terrarium 30m tiles (high resolution)
DEM_SOURCE_ANCHOR_INTERP = "open_meteo_anchor_interp"  # 10x10 Open-Meteo anchors (~1km), ridges/valleys smoothed
DEM_SOURCE_UNKNOWN = "unknown"  # caches written before provenance recording


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance (m) between two WGS84 coordinates."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    return 2.0 * R_EARTH * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))


def dest_point(lat0: float, lon0: float, brg_deg: float, dist_m: float) -> tuple[float, float]:
    """Spherical destination coordinate from (lat0, lon0) along bearing (deg) and distance (m)."""
    la1, lo1 = math.radians(lat0), math.radians(lon0)
    b = math.radians(brg_deg)
    d = dist_m / R_EARTH
    sin_la2 = math.sin(la1) * np.cos(d) + math.cos(la1) * math.sin(d) * math.cos(b)
    la2 = math.asin(max(-1.0, min(1.0, float(sin_la2))))
    lo2 = lo1 + math.atan2(
        math.sin(b) * math.sin(d) * math.cos(la1),
        math.cos(d) - math.sin(la1) * math.sin(la2),
    )
    return math.degrees(la2), math.degrees(lo2)


def _dest_np(
    lat0: float, lon0: float, brg: np.ndarray, dist: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Vectorized spherical destination coordinates for bearings (M,) and distances (N,)."""
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


def fetch_open_meteo_batch(lats: np.ndarray, lons: np.ndarray, timeout: float = 10.0) -> np.ndarray | None:
    """Query up to 100 coordinates from the Open-Meteo Elevation API."""
    lat_str = ",".join(f"{x:.6f}" for x in lats)
    lon_str = ",".join(f"{x:.6f}" for x in lons)
    url = f"{OPEN_METEO_URL}?{urllib.parse.urlencode({'latitude': lat_str, 'longitude': lon_str})}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FireGuard-Research/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "elevation" in data and len(data["elevation"]) == len(lats):
                return np.asarray(data["elevation"], dtype=np.float32)
    except Exception:
        return None
    return None


def fetch_terrarium_dem_grid(
    lat_mesh: np.ndarray,
    lon_mesh: np.ndarray,
    zoom: int = 12,
    cache_dir: Path | str | None = None,
    timeout: float = 8.0,
    allow_download: bool = True,
) -> np.ndarray | None:
    """
    Download or load cached AWS Terrarium 30m elevation PNG tiles (zoom 12)
    and bilinearly sample elevations onto (lat_mesh, lon_mesh) using PIL + NumPy.
    Decoding formula: elevation_m = (R * 256.0 + G + B / 256.0) - 32768.0
    allow_download=False uses only cached tiles (offline / tests) and returns None if any tile is missing.
    """
    try:
        from PIL import Image
    except ImportError:
        return None

    tile_dir = Path(cache_dir) if cache_dir is not None else DEFAULT_TILE_CACHE_DIR

    n = 2.0 ** zoom
    lat_rad = np.radians(lat_mesh)
    xtile_f = (lon_mesh + 180.0) / 360.0 * n
    ytile_f = (1.0 - np.log(np.tan(lat_rad) + 1.0 / np.cos(lat_rad)) / math.pi) / 2.0 * n

    tx_min, tx_max = int(math.floor(float(xtile_f.min()))), int(math.floor(float(xtile_f.max())))
    ty_min, ty_max = int(math.floor(float(ytile_f.min()))), int(math.floor(float(ytile_f.max())))

    nx = tx_max - tx_min + 1
    ny = ty_max - ty_min + 1
    if nx <= 0 or ny <= 0 or nx * ny > 64:
        return None

    mosaic = np.zeros((ny * 256, nx * 256), dtype=np.float32)

    for ty in range(ty_min, ty_max + 1):
        for tx in range(tx_min, tx_max + 1):
            tile_file = tile_dir / f"terrarium_{zoom}_{tx}_{ty}.png"
            if not tile_file.exists():
                if not allow_download:
                    return None
                tile_dir.mkdir(parents=True, exist_ok=True)
                url = TERRARIUM_TILE_URL.format(z=zoom, x=tx, y=ty)
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "FireGuard-Research/1.0"})
                    with urllib.request.urlopen(req, timeout=timeout) as resp:
                        tile_bytes = resp.read()
                    tile_file.write_bytes(tile_bytes)
                except Exception:
                    return None

            try:
                with Image.open(tile_file) as img:
                    rgb = np.asarray(img.convert("RGB"), dtype=np.float32)
                tile_elev = (rgb[:, :, 0] * 256.0 + rgb[:, :, 1] + rgb[:, :, 2] / 256.0) - 32768.0
                r0 = (ty - ty_min) * 256
                c0 = (tx - tx_min) * 256
                mosaic[r0 : r0 + 256, c0 : c0 + 256] = tile_elev
            except Exception:
                return None

    # Sub-pixel bilinear interpolation inside the stitched tile mosaic
    px = (xtile_f - tx_min) * 256.0 - 0.5
    py = (ytile_f - ty_min) * 256.0 - 0.5

    h_m, w_m = mosaic.shape
    px = np.clip(px, 0.0, w_m - 1.000001)
    py = np.clip(py, 0.0, h_m - 1.000001)

    j0 = np.floor(px).astype(int)
    i0 = np.floor(py).astype(int)
    du = py - i0
    dv = px - j0

    v00 = mosaic[i0, j0]
    v01 = mosaic[i0, j0 + 1]
    v10 = mosaic[i0 + 1, j0]
    v11 = mosaic[i0 + 1, j0 + 1]

    sampled = (
        v00 * (1.0 - du) * (1.0 - dv)
        + v01 * (1.0 - du) * dv
        + v10 * du * (1.0 - dv)
        + v11 * du * dv
    )
    return sampled.astype(np.float32)


def _is_valid_dem_cache(
    npz_file: Path,
    center_lat: float,
    center_lon: float,
    radius_m: float,
    grid_size: int,
) -> dict[str, np.ndarray] | None:
    """Validate an existing .npz DEM cache against requested center (<=10m), radius, and grid_size."""
    if not npz_file.exists():
        return None
    try:
        with np.load(npz_file) as data:
            if "center" not in data.files or "radius_m" not in data.files or "elevation" not in data.files:
                return None
            cached_center = data["center"]
            cached_radius = float(data["radius_m"])
            cached_elev = data["elevation"]
            c_dist = haversine_distance(
                center_lat, center_lon, float(cached_center[0]), float(cached_center[1])
            )
            if (
                c_dist <= 10.0
                and abs(cached_radius - radius_m) < 1.0
                and cached_elev.shape == (grid_size, grid_size)
            ):
                out = {k: data[k] for k in data.files}
                out["npz_path"] = npz_file  # type: ignore[assignment]
                # Caches written before source recording are reported as "unknown" and reused as-is
                out["source"] = str(out["source"]) if "source" in out else DEM_SOURCE_UNKNOWN  # type: ignore[assignment]
                return out
    except Exception:
        return None
    return None


def build_and_cache_dem(
    center_lat: float = GACHANG_CAM_LAT,
    center_lon: float = GACHANG_CAM_LON,
    radius_m: float = 5000.0,
    grid_size: int = 201,
    npz_path: Path | str | None = None,
    force_rebuild: bool = False,
    anchor_source=None,
    grid_source=None,
) -> dict[str, np.ndarray]:
    """
    Build a 5km-radius 3D elevation grid for any camera coordinate and cache to an .npz file.
    Validates cache coordinate alignment (haversine <= 10m, radius, grid_size).
    Automatically routes non-Gachang coordinates or mismatched parameters to a dynamic
    file path (dem_{lat:.4f}_{lon:.4f}_{int(radius_m)}m.npz) to protect existing caches.
    Elevation sources can be injected (tests, offline use):
      - anchor_source(lats, lons) -> 1D elevations or None  (default: Open-Meteo batch API)
      - grid_source(lat_mesh, lon_mesh, zoom=12) -> elevation grid or None  (default: AWS Terrarium tiles)
    """
    if anchor_source is None:
        anchor_source = fetch_open_meteo_batch
    if grid_source is None:
        grid_source = fetch_terrarium_dem_grid
    target_path = Path(npz_path) if npz_path is not None else DEFAULT_NPZ_PATH
    dynamic_name = f"dem_{center_lat:.4f}_{center_lon:.4f}_{int(radius_m)}m.npz"

    # 1. 가창면 기본 캐시 파일(gachang_dem.npz) 보호: 좌표(>10m), 반경(!=5000m), 격자(!=201)가 다르면 즉시 동적 파일명으로 분리
    dist_to_gachang = haversine_distance(center_lat, center_lon, GACHANG_CAM_LAT, GACHANG_CAM_LON)
    if target_path == DEFAULT_NPZ_PATH and (
        dist_to_gachang > 10.0 or abs(radius_m - 5000.0) >= 1.0 or grid_size != 201
    ):
        target_path = target_path.parent / dynamic_name

    # 2. 기존 캐시 파일 검증 (좌표 일치도 <= 10m, 반경, 격자 크기 확인)
    #    거친 앵커 보간 캐시는 바로 쓰지 않고, 아래에서 고해상도 소스가 가능하면 다시 만듦
    coarse_fallback: dict[str, np.ndarray] | None = None
    if target_path.exists() and not force_rebuild:
        cached = _is_valid_dem_cache(target_path, center_lat, center_lon, radius_m, grid_size)
        if cached is None:
            # 요청 좌표/파라미터와 기존 파일이 불일치하면 기존 파일을 덮어쓰지 않도록 동적 파일명으로 우회
            target_path = target_path.parent / dynamic_name
            cached = _is_valid_dem_cache(target_path, center_lat, center_lon, radius_m, grid_size)
        if cached is not None:
            if str(cached["source"]) != DEM_SOURCE_ANCHOR_INTERP:
                return cached
            coarse_fallback = cached

    dlat = radius_m / 111320.0
    dlon = radius_m / (111320.0 * math.cos(math.radians(center_lat)))

    lats = np.linspace(center_lat - dlat, center_lat + dlat, grid_size, dtype=np.float64)
    lons = np.linspace(center_lon - dlon, center_lon + dlon, grid_size, dtype=np.float64)
    lon_mesh, lat_mesh = np.meshgrid(lons, lats)

    # 1. Verify Open-Meteo Elevation API connectivity on a 10x10 (100-point) anchor grid
    anchor_lats = np.linspace(center_lat - dlat, center_lat + dlat, 10)
    anchor_lons = np.linspace(center_lon - dlon, center_lon + dlon, 10)
    a_lon_m, a_lat_m = np.meshgrid(anchor_lons, anchor_lats)

    # 2. Populate dense 201x201 (~50m step) elevation matrix using the grid source (AWS Terrarium 30m tiles),
    #    falling back to anchor bilinear interpolation when the grid source is unavailable (offline)
    sampled = grid_source(lat_mesh, lon_mesh, zoom=12)
    grid_ok = sampled is not None and not np.isnan(sampled).any()
    if not grid_ok and coarse_fallback is not None:
        # Still offline: keep the existing coarse cache instead of rebuilding the same coarse grid
        return coarse_fallback

    api_elev = anchor_source(a_lat_m.ravel(), a_lon_m.ravel())
    elev_grid: np.ndarray | None = None
    source = DEM_SOURCE_TERRARIUM
    if grid_ok:
        elev_grid = np.asarray(sampled, dtype=np.float32)
        if api_elev is not None:
            t_anchor = grid_source(a_lat_m, a_lon_m, zoom=12)
            if t_anchor is not None:
                datum_bias = float(np.median(api_elev - np.asarray(t_anchor).ravel()))
                if abs(datum_bias) < 5.0:
                    elev_grid = elev_grid + datum_bias * 0.1

    if elev_grid is None:
        if api_elev is not None:
            anchor_interp = RegularGridInterpolator(
                (anchor_lats, anchor_lons),
                api_elev.reshape(10, 10),
                method="linear",
                bounds_error=False,
                fill_value=None,
            )
            pts = np.column_stack([lat_mesh.ravel(), lon_mesh.ravel()])
            elev_grid = anchor_interp(pts).reshape(grid_size, grid_size).astype(np.float32)
            source = DEM_SOURCE_ANCHOR_INTERP
        else:
            raise RuntimeError("DEM 데이터를 다운로드할 수 없습니다. 네트워크 상태를 확인해주세요.")

    target_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        target_path,
        lats=lats,
        lons=lons,
        elevation=elev_grid,
        center=np.array([center_lat, center_lon], dtype=np.float64),
        radius_m=np.array(radius_m, dtype=np.float64),
        source=np.array(source),
    )
    return {
        "lats": lats,
        "lons": lons,
        "elevation": elev_grid,
        "center": np.array([center_lat, center_lon], dtype=np.float64),
        "radius_m": np.array(radius_m, dtype=np.float64),
        "source": source,  # type: ignore[dict-item]
        "npz_path": target_path,  # type: ignore[dict-item]
    }


def build_and_cache_gachang_dem(
    center_lat: float = GACHANG_CAM_LAT,
    center_lon: float = GACHANG_CAM_LON,
    radius_m: float = 5000.0,
    grid_size: int = 201,
    npz_path: Path | str | None = None,
    force_rebuild: bool = False,
    anchor_source=None,
    grid_source=None,
) -> dict[str, np.ndarray]:
    """Backward-compatible wrapper around build_and_cache_dem()."""
    return build_and_cache_dem(
        center_lat=center_lat,
        center_lon=center_lon,
        radius_m=radius_m,
        grid_size=grid_size,
        npz_path=npz_path,
        force_rebuild=force_rebuild,
        anchor_source=anchor_source,
        grid_source=grid_source,
    )


class DEMProvider:
    """
    High-speed DEM Elevation & 360-degree Synthetic Skyline Provider
    powered by RegularGridInterpolator (sub-millisecond bilinear interpolation).
    """

    def __init__(
        self,
        cam_lat: float = GACHANG_CAM_LAT,
        cam_lon: float = GACHANG_CAM_LON,
        radius_m: float = 5000.0,
        npz_path: Path | str | None = None,
        tower_height_m: float = 15.0,
    ):
        self.cam_lat = float(cam_lat)
        self.cam_lon = float(cam_lon)
        self.radius_m = float(radius_m)
        self.npz_path = Path(npz_path) if npz_path is not None else DEFAULT_NPZ_PATH
        self.tower_height_m = float(tower_height_m)

        data = build_and_cache_dem(
            center_lat=self.cam_lat,
            center_lon=self.cam_lon,
            radius_m=self.radius_m,
            npz_path=self.npz_path,
        )
        self.npz_path = Path(data.get("npz_path", self.npz_path))  # type: ignore[arg-type]
        self.lats = data["lats"]
        self.lons = data["lons"]
        self.elevation = data["elevation"]
        # DEM provenance (terrarium / open_meteo_anchor_interp / unknown): coarse grids smooth ridges and valleys
        self.dem_source = str(data.get("source", DEM_SOURCE_UNKNOWN))

        self.interpolator = RegularGridInterpolator(
            (self.lats, self.lons),
            self.elevation,
            method="linear",
            bounds_error=False,
            fill_value=None,
        )

        self.ground_alt = float(self.get_elevation(self.cam_lat, self.cam_lon))
        self.eye_alt = self.ground_alt + self.tower_height_m

        # Pre-computed 360-degree Synthetic Skyline Lookup Table (LUT)
        self.az_grid: np.ndarray | None = None
        self.skyline_el_deg: np.ndarray | None = None
        self.skyline_dist_m: np.ndarray | None = None
        self.compute_synthetic_skyline()

    def get_elevation(self, lat: float | np.ndarray, lon: float | np.ndarray) -> float | np.ndarray:
        """Return bilinearly interpolated elevation (m) in < 0.001s."""
        if np.isscalar(lat) and np.isscalar(lon):
            val = self.interpolator(np.array([[float(lat), float(lon)]], dtype=np.float64))
            return float(val[0])

        lat_arr = np.asarray(lat, dtype=np.float64)
        lon_arr = np.asarray(lon, dtype=np.float64)
        orig_shape = lat_arr.shape
        pts = np.column_stack([lat_arr.ravel(), lon_arr.ravel()])
        out = self.interpolator(pts)
        return out.reshape(orig_shape)

    def compute_synthetic_skyline(
        self,
        az_step_deg: float = 0.1,
        near_m: float = 250.0,
        max_range_m: float = 5000.0,
        n_samples: int = 240,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Pre-compute 360° Synthetic Skyline elevation angle profile with Earth curvature
        and atmospheric refraction (k=0.13) correction. Cached in memory as a 1D Geo-LUT.
        """
        n_az = int(round(360.0 / az_step_deg))
        self.az_grid = np.arange(n_az, dtype=np.float64) * az_step_deg
        dist = near_m * ((max_range_m / near_m) ** (np.arange(n_samples) / (n_samples - 1)))

        lat_mat, lon_mat = _dest_np(self.cam_lat, self.cam_lon, self.az_grid, dist)
        h_mat = self.get_elevation(lat_mat, lon_mat)

        # Earth curvature and atmospheric refraction correction: drop = d^2 / (2R) * (1 - k)
        drop = (dist ** 2) / (2.0 * R_EARTH) * (1.0 - K_REFRACTION)
        ang_mat = np.degrees(np.arctan2(h_mat - drop[None, :] - self.eye_alt, dist[None, :]))

        max_idx = np.argmax(ang_mat, axis=1)
        self.skyline_el_deg = ang_mat[np.arange(n_az), max_idx]
        self.skyline_dist_m = dist[max_idx]
        return self.az_grid, self.skyline_el_deg

    def project_skyline(
        self,
        pan: float,
        tilt: float,
        roll: float = 0.0,
        width: int = 1920,
        height: int = 1080,
        fov_h: float = 60.0,
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Project the 360° synthetic skyline into the image with the exact pinhole rotation model.
        Returns (x, y) sorted by x for the skyline directions in front of the camera (x within ±1 frame width).
        """
        assert self.az_grid is not None and self.skyline_el_deg is not None
        x, y, front = direction_to_pixel(self.az_grid, self.skyline_el_deg, pan, tilt, roll, width, height, fov_h)
        keep = front & (x > -width) & (x < 2.0 * width)
        x, y = x[keep], y[keep]
        order = np.argsort(x)
        return x[order], y[order]

    def skyline_y_at(
        self,
        xs: np.ndarray,
        pan: float,
        tilt: float,
        roll: float = 0.0,
        width: int = 1920,
        height: int = 1080,
        fov_h: float = 60.0,
    ) -> np.ndarray:
        """Image row of the projected synthetic skyline at columns xs (exact pinhole rotation model)."""
        px, py = self.project_skyline(pan, tilt, roll, width, height, fov_h)
        return np.interp(np.asarray(xs, dtype=np.float64), px, py)

    def synthesize_observed_skyline(
        self,
        true_pan: float,
        true_tilt: float,
        true_roll: float = 0.0,
        width: int = 1920,
        height: int = 1080,
        fov_h: float = 60.0,
        step_px: int = 20,
        noise_std_px: float = 0.5,
        seed: int = 42,
    ) -> np.ndarray:
        """Project the 3D DEM skyline onto 2D CCTV image pixels for a given true camera pose."""
        xs = np.arange(80, width - 80, step_px, dtype=np.float64)
        ys = self.skyline_y_at(xs, true_pan, true_tilt, true_roll, width, height, fov_h)

        if noise_std_px > 0.0:
            rng = np.random.default_rng(seed)
            ys = ys + rng.normal(0.0, noise_std_px, size=ys.shape)

        valid = (ys >= 0.0) & (ys < height)
        return np.column_stack([xs[valid], ys[valid]])

    @staticmethod
    def _clean_ridge_y(ys: np.ndarray) -> np.ndarray:
        """Moving median (5 samples) + MAD outlier replacement to reject tree branches / utility poles."""
        med_y = np.array([np.median(ys[max(0, i - 2) : min(len(ys), i + 3)]) for i in range(len(ys))])
        mad = max(1.0, float(np.median(np.abs(ys - med_y))) * 1.4826)
        return np.where(np.abs(ys - med_y) <= 2.5 * mad, ys, med_y)

    def _fit_pose_exact(
        self,
        xs: np.ndarray,
        ys: np.ndarray,
        pan_cands: np.ndarray,
        roll_cands: np.ndarray,
        tilt_init: float | np.ndarray,
        width: int,
        height: int,
        fov_h: float,
        tilt_iters: int = 4,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        Exact pinhole-rotation fit of observed ridge pixels (xs, ys) to the synthetic skyline.
        Evaluates every (pan, roll) candidate pair; tilt is solved per candidate by fixed-point
        iteration on the mean vertical residual (image rows shift by about f * d_tilt).
        Returns flattened arrays (pan, tilt, roll, rms_px); rms_px is inf when the projected
        skyline does not cover all observed columns.
        """
        assert self.az_grid is not None and self.skyline_el_deg is not None
        f = focal_length_px(width, fov_h)
        P, R = np.meshgrid(np.asarray(pan_cands, float) % 360.0, np.asarray(roll_cands, float), indexing="ij")
        P, R = P.ravel(), R.ravel()
        T = np.broadcast_to(np.asarray(tilt_init, float), P.shape).astype(float).copy()

        # Only skyline directions near the candidate pans can reach the image
        half = fov_h / 2.0 + 10.0
        dist = np.abs(((self.az_grid[:, None] - P[None, :]) + 180.0) % 360.0 - 180.0).min(axis=1)
        sel = dist <= half
        D = direction_vectors(self.az_grid[sel], self.skyline_el_deg[sel])  # (N, 3)

        rms = np.full(P.shape, np.inf)
        for it in range(tilt_iters + 1):
            fwd, right, up = camera_basis_batch(P, T, R)
            z = D @ fwd.T
            X = width / 2.0 + f * (D @ right.T) / np.where(z > 0.2, z, np.nan)
            Y = height / 2.0 - f * (D @ up.T) / np.where(z > 0.2, z, np.nan)
            mean_res = np.zeros(P.shape)
            for k in range(P.size):
                ok = np.isfinite(X[:, k])
                xk, yk = X[ok, k], Y[ok, k]
                if xk.size < 2 or xs.min() < xk.min() or xs.max() > xk.max():
                    rms[k] = np.inf
                    continue
                o = np.argsort(xk)
                res = ys - np.interp(xs, xk[o], yk[o])
                mean_res[k] = float(res.mean())
                rms[k] = float(np.sqrt(np.mean((res - (res.mean() if it < tilt_iters else 0.0)) ** 2)))
            if it < tilt_iters:
                # observed rows lower than predicted (positive residual) -> camera points higher
                T = T + np.degrees(np.arctan(mean_res / f))
        return P, T, R, rms

    def calibrate_ptz_zero_point(
        self,
        init_pan: float,
        init_tilt: float,
        ridge_pts: np.ndarray | list[tuple[float, float]],
        width: int = 1920,
        height: int = 1080,
        fov_h: float = 60.0,
        search_window_deg: float = 5.0,
        step_deg: float = 0.05,
        roll_max_deg: float = 2.5,
    ) -> dict[str, float]:
        """
        Zero-point PTZ Self-Calibration: matches observed frame skyline pixels against the
        360° synthetic skyline with the exact pinhole rotation model (coarse-to-fine pan/roll search,
        tilt solved per candidate). d_tilt stays bounded by ±search_window_deg as before.
        """
        assert self.az_grid is not None and self.skyline_el_deg is not None
        pts = np.asarray(ridge_pts, dtype=np.float64)
        if len(pts) < 3:
            return {
                "pan": init_pan,
                "tilt": init_tilt,
                "roll": 0.0,
                "d_pan": 0.0,
                "d_tilt": 0.0,
                "rms_deg": 0.0,
            }

        xs = pts[:, 0]
        clean_y = self._clean_ridge_y(pts[:, 1])
        f = focal_length_px(width, fov_h)

        # Stage 1: coarse pan (0.25°) x roll (0.5°) grid inside the search window
        coarse_pans = init_pan + np.arange(-search_window_deg, search_window_deg + 1e-6, 0.25)
        coarse_rolls = np.arange(-roll_max_deg, roll_max_deg + 1e-6, 0.5)
        P, T, R, rms = self._fit_pose_exact(xs, clean_y, coarse_pans, coarse_rolls, init_tilt, width, height, fov_h)
        k = int(np.argmin(rms))

        # Stage 2: fine pan (step_deg) x roll (0.1°) around the best coarse candidate
        d_best = ((P[k] - init_pan + 180.0) % 360.0) - 180.0
        fine_pans = init_pan + np.clip(
            d_best + np.arange(-0.3, 0.3 + 1e-6, step_deg), -search_window_deg, search_window_deg
        )
        fine_rolls = np.clip(R[k] + np.arange(-0.5, 0.5 + 1e-6, 0.1), -roll_max_deg, roll_max_deg)
        P, T, R, rms = self._fit_pose_exact(
            xs, clean_y, np.unique(fine_pans), np.unique(fine_rolls), T[k], width, height, fov_h
        )
        k = int(np.argmin(rms))

        best_dpan = float(((P[k] - init_pan + 180.0) % 360.0) - 180.0)
        best_dtilt = float(np.clip(T[k] - init_tilt, -search_window_deg, search_window_deg))
        return {
            "pan": (init_pan + best_dpan) % 360.0,
            "tilt": init_tilt + best_dtilt,
            "roll": float(R[k]),
            "d_pan": best_dpan,
            "d_tilt": best_dtilt,
            "rms_deg": float(math.degrees(math.atan(float(rms[k]) / f))) if np.isfinite(rms[k]) else 999.0,
        }

    def estimate_blind_ptz(
        self,
        ridge_pts: np.ndarray | list[tuple[float, float]],
        width: int = 1920,
        height: int = 1080,
        fov_h: float = 60.0,
        coarse_step_deg: float = 0.5,
        fine_window_deg: float = 2.0,
        fine_step_deg: float = 0.05,
        roll_max_deg: float = 2.5,
        min_relief_std_deg: float = 0.12,
        min_ncc: float = 0.65,
        max_rms_deg: float = 1.5,
        min_tilt_deg: float = -15.0,
        max_tilt_deg: float = 25.0,
    ) -> dict[str, float | bool | str | None]:
        """
        360° Blind Camera Pose (Pan, Tilt, Roll) Estimation for live CCTVs without PTZ metadata.
        Executes a Coarse-to-Fine global search across 0°..360° with a 3-way fail-safe check:
          1. Ridge relief standard deviation >= min_relief_std_deg (0.12°)
          2. Roll-compensated Normalized Cross-Correlation (NCC) >= min_ncc (0.65)
          3. Residual rms_deg <= max_rms_deg (1.5°) and physical tilt within [-15°, +25°]
        """
        assert self.az_grid is not None and self.skyline_el_deg is not None
        pts = np.asarray(ridge_pts, dtype=np.float64)
        if len(pts) < 15:
            return {
                "calibrated": False,
                "status": "CALIBRATION_FAILED",
                "reason": "INSUFFICIENT_RIDGE",
                "pan": None,
                "tilt": None,
                "roll": None,
                "d_pan": 0.0,
                "d_tilt": 0.0,
                "rms_deg": 999.0,
                "ncc": 0.0,
                "obs_std_deg": 0.0,
            }

        xs, ys = pts[:, 0], pts[:, 1]
        med_y = np.array(
            [np.median(ys[max(0, i - 2) : min(len(ys), i + 3)]) for i in range(len(ys))]
        )
        mad = max(1.0, float(np.median(np.abs(ys - med_y))) * 1.4826)
        clean_y = np.where(np.abs(ys - med_y) <= 2.5 * mad, ys, med_y)

        f = (width / 2.0) / math.tan(math.radians(fov_h / 2.0))
        cx, cy = width / 2.0, height / 2.0

        r_off = np.degrees(np.arctan((xs - cx) / f))
        r_el_zero = np.degrees(np.arctan((cy - clean_y) / f))

        raw_obs_std = float(np.std(r_el_zero))
        if raw_obs_std < min_relief_std_deg * 0.8:
            return {
                "calibrated": False,
                "status": "CALIBRATION_FAILED",
                "reason": "LOW_RELIEF",
                "pan": None,
                "tilt": None,
                "roll": None,
                "d_pan": 0.0,
                "d_tilt": 0.0,
                "rms_deg": 999.0,
                "ncc": 0.0,
                "obs_std_deg": raw_obs_std,
            }

        az_ext = np.append(self.az_grid, 360.0)
        sky_ext = np.append(self.skyline_el_deg, self.skyline_el_deg[0])
        oc = r_off - r_off.mean()
        oc_denom = max(float((oc ** 2).sum()), 1e-6)
        roll_max_tan = math.tan(math.radians(roll_max_deg))

        def _eval_candidates(cand_pans: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
            query_az = (cand_pans[:, None] + r_off[None, :]) % 360.0
            hor_mat = np.interp(query_az, az_ext, sky_ext)

            diff = hor_mat - r_el_zero[None, :]
            dmean = diff.mean(axis=1)
            rr = np.clip(
                ((diff - dmean[:, None]) * oc[None, :]).sum(axis=1) / oc_denom,
                -roll_max_tan,
                roll_max_tan,
            )
            # Unclipped least-squares tilt: clipping here would hide an out-of-range pose from the
            # final physical tilt check (it would always pass), so the range is enforced only at the end
            cc = dmean - rr * r_off.mean()
            res = diff - cc[:, None] - rr[:, None] * r_off[None, :]
            rms = np.sqrt(np.mean(res ** 2, axis=1))

            # Roll-compensated observed elevation profile: r_el_zero + rr * r_off
            obs_unrolled = r_el_zero[None, :] + rr[:, None] * r_off[None, :]
            h_cent = hor_mat - hor_mat.mean(axis=1, keepdims=True)
            o_cent = obs_unrolled - obs_unrolled.mean(axis=1, keepdims=True)
            h_std = np.std(hor_mat, axis=1)
            o_std = np.std(obs_unrolled, axis=1)
            ncc = np.mean(h_cent * o_cent, axis=1) / np.maximum(h_std * o_std, 1e-6)
            return cc, rr, rms, ncc, h_std, o_std

        # Stage 1: Coarse 360° scan
        coarse_pans = np.arange(0.0, 360.0, coarse_step_deg)
        c_cc, c_rr, c_rms, c_ncc, c_hstd, _ = _eval_candidates(coarse_pans)

        # Penalize candidates that lack terrain relief or shape correlation
        valid_mask = (c_hstd >= min_relief_std_deg) & (c_ncc >= 0.4)
        score_rms = np.where(valid_mask, c_rms, c_rms + 50.0)
        top_indices = np.argsort(score_rms)[:5]

        # Stage 2: Fine scan around top coarse candidates
        fine_offsets = np.arange(-fine_window_deg, fine_window_deg + 1e-6, fine_step_deg)
        fine_pans = np.unique(
            ((coarse_pans[top_indices, None] + fine_offsets[None, :]) % 360.0).ravel()
        )
        f_cc, f_rr, f_rms, f_ncc, f_hstd, f_ostd = _eval_candidates(fine_pans)

        f_valid = (f_hstd >= min_relief_std_deg) & (f_ostd >= min_relief_std_deg)
        f_score = np.where(f_valid, f_rms, f_rms + 50.0)

        # Stage 3: exact pinhole-rotation refinement. The small-angle stages above only propose seeds;
        # up to 3 distinct seeds (>= 2° apart) are refined so a ranking change between models is not missed.
        seeds: list[tuple[float, float]] = []
        for k in np.argsort(f_score):
            pan_k = float(fine_pans[k]) % 360.0
            if all(abs(((pan_k - s + 180.0) % 360.0) - 180.0) >= 2.0 for s, _ in seeds):
                seeds.append((pan_k, float(f_cc[k])))
            if len(seeds) == 3:
                break

        xs = pts[:, 0]
        rolls_coarse = np.arange(-roll_max_deg, roll_max_deg + 1e-6, 0.5)
        best: tuple[float, float, float, float] | None = None  # (rms_px, pan, tilt, roll)
        for seed_pan, seed_tilt in seeds:
            P, T, R, rms = self._fit_pose_exact(
                xs, clean_y, seed_pan + np.arange(-1.0, 1.0 + 1e-6, 0.1), rolls_coarse, seed_tilt, width, height, fov_h
            )
            k = int(np.argmin(rms))
            if best is None or rms[k] < best[0]:
                best = (float(rms[k]), float(P[k]), float(T[k]), float(R[k]))
        assert best is not None
        _, bp, bt, br = best
        P, T, R, rms = self._fit_pose_exact(
            xs,
            clean_y,
            bp + np.arange(-0.15, 0.15 + 1e-6, 0.025),
            np.clip(br + np.arange(-0.5, 0.5 + 1e-6, 0.1), -roll_max_deg, roll_max_deg),
            bt,
            width,
            height,
            fov_h,
        )
        k = int(np.argmin(rms))
        best_pan, best_tilt, best_roll = float(P[k]) % 360.0, float(T[k]), float(R[k])

        # Quality metrics in angle space at the exact pose
        az_obs, el_obs = pixel_to_direction(xs, clean_y, best_pan, best_tilt, best_roll, width, height, fov_h)
        el_sky = np.interp(az_obs % 360.0, az_ext, sky_ext)
        best_rms = float(np.sqrt(np.mean((el_obs - el_sky) ** 2))) if np.isfinite(rms[k]) else 999.0
        best_hstd = float(np.std(el_sky))
        best_ostd = float(np.std(el_obs))
        best_ncc = float(
            np.mean((el_obs - el_obs.mean()) * (el_sky - el_sky.mean())) / max(best_hstd * best_ostd, 1e-6)
        )

        reason: str | None = None
        if best_ostd < min_relief_std_deg or best_hstd < min_relief_std_deg:
            reason = "LOW_RELIEF"
        elif best_ncc < min_ncc:
            reason = "LOW_CORRELATION"
        elif best_rms > max_rms_deg:
            reason = "HIGH_RESIDUAL"
        elif not (min_tilt_deg <= best_tilt <= max_tilt_deg):
            reason = "TILT_OUT_OF_RANGE"
        is_valid_pose = reason is None

        if not is_valid_pose:
            return {
                "calibrated": False,
                "status": "CALIBRATION_FAILED",
                "reason": reason,
                "pan": None,
                "tilt": None,
                "roll": None,
                "d_pan": 0.0,
                "d_tilt": 0.0,
                "rms_deg": best_rms,
                "ncc": best_ncc,
                "obs_std_deg": best_ostd,
            }

        return {
            "calibrated": True,
            "status": "OK",
            "reason": None,
            "pan": best_pan,
            "tilt": best_tilt,
            "roll": best_roll,
            "d_pan": 0.0,
            "d_tilt": 0.0,
            "rms_deg": best_rms,
            "ncc": best_ncc,
            "obs_std_deg": best_ostd,
        }


if __name__ == "__main__":
    t0 = time.perf_counter() if "time" in globals() else 0.0
    import time

    t_start = time.perf_counter()
    provider = DEMProvider()
    t_init = (time.perf_counter() - t_start) * 1000.0

    t_q0 = time.perf_counter()
    sample_alt = provider.get_elevation(GACHANG_CAM_LAT, GACHANG_CAM_LON)
    t_query_ms = (time.perf_counter() - t_q0) * 1000.0

    print("=" * 70)
    print(f"[DEMProvider 초기화 완료] 캐시 파일: {provider.npz_path.name}")
    print(f" - 격자 크기: {provider.elevation.shape} (반경 {provider.radius_m:.0f}m)")
    print(f" - 가창 오리 CCTV 지면 해발고도: {sample_alt:.2f}m (카메라 해발고도: {provider.eye_alt:.2f}m)")
    print(f" - 단일 좌표 보간 조회 소요시간: {t_query_ms:.4f} ms (< 1 ms 실시간 기준 충족)")
    print(f" - 360° 가상 산능선(Synthetic Skyline) 최고 고도각: {provider.skyline_el_deg.max():.2f}°")
    print("=" * 70)
