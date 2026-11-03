from __future__ import annotations

from pathlib import Path
import numpy as np

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False


class SkylineExtractor:
    """
    Automatic Mountain Skyline (Ridge) Detector for Wildfire Surveillance CCTV Frames.
    Implemented in pure NumPy + PIL (no OpenCV/SciPy dependency):
      1. Channel-order (RGB/BGR) and solar-backlight invariant Luminance transition map
      2. Local corner OSD masking (preserving high mountain peaks at y = 30~100px)
      3. Horizontal smoke bounding-box masking ([x_min_px, x_max_px])
      4. 1D Dynamic Programming (Viterbi continuous seam) + Moving Median (MAD) filter
    """

    def __init__(
        self,
        step_px: int = 20,
        margin_x_px: int = 80,
        min_y_px: int = 2,
        max_y_ratio: float = 0.82,
        min_contrast_drop: float = 14.0,
        smooth_penalty: float = 0.45,
        max_step_per_col_px: int = 35,
    ):
        self.step_px = int(step_px)
        self.margin_x_px = int(margin_x_px)
        self.min_y_px = int(min_y_px)
        self.max_y_ratio = float(max_y_ratio)
        self.min_contrast_drop = float(min_contrast_drop)
        self.smooth_penalty = float(smooth_penalty)
        self.max_step_per_col_px = int(max_step_per_col_px)

    @staticmethod
    def _to_luminance(frame: np.ndarray | str | Path | object) -> np.ndarray:
        """
        Convert input frame (np.ndarray RGB/BGR/Gray, PIL.Image, or file path)
        into a 2D float32 luminance array in [0, 255].
        Uses channel-mean luminance (R+G+B)/3 so RGB and BGR arrays produce identical results
        and bright white/yellow backlit skies remain high-intensity.
        """
        if isinstance(frame, (str, Path)):
            if not PIL_AVAILABLE:
                raise RuntimeError("이미지 파일 로드를 위해 Pillow(PIL)가 필요합니다.")
            with Image.open(frame) as img:
                arr = np.asarray(img.convert("RGB"), dtype=np.float32)
        elif PIL_AVAILABLE and isinstance(frame, Image.Image):
            arr = np.asarray(frame.convert("RGB"), dtype=np.float32)
        else:
            arr = np.asarray(frame, dtype=np.float32)

        if arr.ndim == 2:
            lum = arr
        elif arr.ndim == 3 and arr.shape[2] >= 3:
            lum = arr[:, :, :3].mean(axis=2)
        else:
            raise ValueError(f"지원하지 않는 영상 프레임 차원입니다: {arr.shape}")

        if lum.max() <= 1.0 and lum.max() > 0.0:
            lum = lum * 255.0
        return lum.astype(np.float32)

    @staticmethod
    def _window_mean_vertical(lum: np.ndarray, win_h: int) -> tuple[np.ndarray, np.ndarray]:
        """
        Compute vertical upper-window mean [y - win_h, y) and lower-window mean [y, y + win_h)
        for every pixel in O(1) using cumulative sums along axis=0.
        """
        h, w = lum.shape
        pad = np.pad(lum, ((win_h, win_h), (0, 0)), mode="edge")
        csum = np.vstack([np.zeros((1, w), dtype=np.float64), np.cumsum(pad, axis=0, dtype=np.float64)])

        idx = np.arange(win_h, win_h + h)
        above = (csum[idx] - csum[idx - win_h]) / float(win_h)
        below = (csum[idx + win_h] - csum[idx]) / float(win_h)
        return above.astype(np.float32), below.astype(np.float32)

    def extract(
        self,
        frame: np.ndarray | str | Path | object,
        smoke_x_range: tuple[float, float] | list[float] | None = None,
        step_px: int | None = None,
        smoke_pad_px: float = 16.0,
    ) -> dict[str, np.ndarray | bool | float]:
        """
        Extract skyline pixel coordinates (xs, ys) and validity metrics from an input frame.
        Returns:
            {
                "ridge_pts": np.ndarray of shape (N, 2),
                "is_valid": bool,
                "confidence": float (0.0 ~ 1.0),
                "mean_drop": float,
            }
        """
        lum = self._to_luminance(frame)
        height, width = lum.shape
        col_step = int(step_px if step_px is not None else self.step_px)

        if height < 120 or width < 200 or float(np.std(lum)) < 4.5:
            return {
                "ridge_pts": np.empty((0, 2), dtype=np.float64),
                "is_valid": False,
                "confidence": 0.0,
                "mean_drop": 0.0,
            }

        # 1. Multi-scale vertical brightness drop (above - below) + mountain body hold check
        w_short = max(8, int(round(height * 0.012)))   # ~13px at 1080p
        w_long = max(24, int(round(height * 0.045)))   # ~48px at 1080p

        above_s, below_s = self._window_mean_vertical(lum, w_short)
        above_l, below_l = self._window_mean_vertical(lum, w_long)

        # Exact 1-pixel and 2-pixel vertical boundary gradients (peaks strictly at the sky-mountain boundary)
        edge_1px = np.zeros_like(lum)
        edge_1px[1:, :] = lum[:-1, :] - lum[1:, :]
        edge_2px = np.zeros_like(lum)
        edge_2px[1:-1, :] = lum[:-2, :] - lum[2:, :]

        raw_drop = (
            0.40 * (above_s - below_s)
            + 0.25 * (above_l - below_l)
            + 0.25 * edge_1px
            + 0.10 * edge_2px
        )

        # Cumulative mean from the top of the frame down to row y:
        # True sky-to-mountain boundary has unobstructed bright sky above it, whereas foreground
        # buildings in the lower valley have hundreds of pixels of dark mountain above them.
        # Top-left camera name / timestamp OSD box (x < 17% W, y < 4.2% H -> 326x45 at 1920x1080)
        osd_tl_x = int(width * 0.17)
        osd_tl_y = int(height * 0.042)
        lum_for_top = lum.copy()
        if osd_tl_x > 0 and osd_tl_y > 0:
            lum_for_top[:osd_tl_y, :osd_tl_x] = lum_for_top[osd_tl_y : osd_tl_y + 10, :osd_tl_x].mean()

        csum_top = np.cumsum(lum_for_top, axis=0, dtype=np.float64)
        row_counts = np.arange(1, height + 1, dtype=np.float64)[:, None]
        mean_from_top = (csum_top / row_counts).astype(np.float32)

        # Upper-sky reference brightness (95th percentile of top 5% of frame outside top-left OSD)
        sky_ref = float(np.percentile(lum_for_top[: max(15, int(height * 0.05)), osd_tl_x:], 95))
        ground_ref = float(np.percentile(lum_for_top[int(height * 0.20) : int(height * 0.75), :], 25))
        sky_span = max(sky_ref - ground_ref, 15.0)

        # Sky purity above row y: high when [0..y] is bright sky, low when dark mountain lies above y
        sky_purity = np.clip((mean_from_top - ground_ref) / sky_span, 0.0, 1.0)

        # Sustained mountain body hold condition:
        # Both short and long lower windows must be darker than the sky above
        hold_cond = (above_s > below_s + 4.0) & (above_l > below_l + 4.0)

        strength = np.where(hold_cond, np.maximum(0.0, raw_drop) * (0.25 + 0.75 * (sky_purity ** 2)), 0.0)

        # 2. Local Corner OSD Masking (preserving top mountain peaks at y = 3~100px in main view!)
        y_min = max(self.min_y_px, 2)
        y_max = min(height - w_long - 1, int(height * self.max_y_ratio))
        if y_max <= y_min + 10:
            return {
                "ridge_pts": np.empty((0, 2), dtype=np.float64),
                "is_valid": False,
                "confidence": 0.0,
                "mean_drop": 0.0,
            }

        strength[:y_min, :] = 0.0
        strength[y_max:, :] = 0.0

        # Top-left timestamp OSD box only (x < 17% W, y < 4.2% H -> 326x45 at 1920x1080)
        strength[:osd_tl_y, :osd_tl_x] = 0.0

        # Bottom-left camera name OSD box only (x < 24% W, y > 82% H -> 460x885 at 1920x1080)
        osd_bl_x = int(width * 0.24)
        osd_bl_y = int(height * 0.82)
        strength[osd_bl_y:, :osd_bl_x] = 0.0

        # 3. Sample horizontal grid columns and apply Smoke BBox Horizontal Masking
        xs = np.arange(self.margin_x_px, width - self.margin_x_px, col_step, dtype=np.int32)
        if len(xs) < 15:
            return {
                "ridge_pts": np.empty((0, 2), dtype=np.float64),
                "is_valid": False,
                "confidence": 0.0,
                "mean_drop": 0.0,
            }

        smoke_mask_cols = np.zeros(len(xs), dtype=bool)
        if smoke_x_range is not None and len(smoke_x_range) >= 2:
            sx0 = float(min(smoke_x_range[0], smoke_x_range[1])) - smoke_pad_px
            sx1 = float(max(smoke_x_range[0], smoke_x_range[1])) + smoke_pad_px
            smoke_mask_cols = (xs >= sx0) & (xs <= sx1)

        # 4. 1D Dynamic Programming (Viterbi horizontal seam optimization)
        y_band = np.arange(y_min, y_max, dtype=np.int32)
        n_rows = len(y_band)
        n_cols = len(xs)

        col_scores = strength[y_min:y_max, xs].copy()

        # If any column has no sky at the very top (mountain peak rises above y=0 top border of the frame),
        # neutralize its transition score so DP bridges across the clipped mountain top
        top_2px_lum = lum_for_top[:2, xs].max(axis=0)
        clipped_top_cols = top_2px_lum < (ground_ref + 0.40 * sky_span)
        if np.any(clipped_top_cols):
            col_scores[:, clipped_top_cols] = 0.0

        # Neutralize transition scores inside the smoke plume span so DP bridges smoothly across
        if np.any(smoke_mask_cols):
            col_scores[:, smoke_mask_cols] = 0.0

        dp = np.zeros((n_rows, n_cols), dtype=np.float64)
        backptr = np.zeros((n_rows, n_cols), dtype=np.int32)
        dp[:, 0] = -col_scores[:, 0]

        max_dy = min(self.max_step_per_col_px, n_rows - 1)
        dys = np.arange(-max_dy, max_dy + 1, dtype=np.int32)
        step_penalties = self.smooth_penalty * np.abs(dys) + 0.035 * (dys ** 2)

        for k in range(1, n_cols):
            prev_col = dp[:, k - 1]
            # Vectorized min over transition offsets dys
            best_prev = np.full(n_rows, np.inf, dtype=np.float64)
            best_idx = np.arange(n_rows, dtype=np.int32)

            for d_idx, dy in enumerate(dys):
                pen = step_penalties[d_idx]
                if dy < 0:
                    cand = prev_col[: dy] + pen
                    target_slice = slice(-dy, n_rows)
                    src_idx = np.arange(0, n_rows + dy, dtype=np.int32)
                elif dy > 0:
                    cand = prev_col[dy:] + pen
                    target_slice = slice(0, n_rows - dy)
                    src_idx = np.arange(dy, n_rows, dtype=np.int32)
                else:
                    cand = prev_col + pen
                    target_slice = slice(0, n_rows)
                    src_idx = np.arange(0, n_rows, dtype=np.int32)

                better = cand < best_prev[target_slice]
                cur_best = best_prev[target_slice]
                cur_idx = best_idx[target_slice]
                cur_best[better] = cand[better]
                cur_idx[better] = src_idx[better]

            dp[:, k] = -col_scores[:, k] + best_prev
            backptr[:, k] = best_idx

        # Backtrack optimal continuous skyline path
        path_idx = np.zeros(n_cols, dtype=np.int32)
        path_idx[-1] = int(np.argmin(dp[:, -1]))
        for k in range(n_cols - 1, 0, -1):
            path_idx[k - 1] = backptr[path_idx[k], k]

        ys_raw = y_band[path_idx].astype(np.float64)

        # 5. Moving Median (MAD) outlier filter to reject local tree/pole spikes
        med_y = np.array(
            [np.median(ys_raw[max(0, i - 2) : min(n_cols, i + 3)]) for i in range(n_cols)]
        )
        mad = max(1.0, float(np.median(np.abs(ys_raw - med_y))) * 1.4826)
        ys_clean = np.where(np.abs(ys_raw - med_y) <= 2.5 * mad, ys_raw, med_y)

        # Exclude smoke-masked columns, top-left OSD columns, and top-border-clipped columns
        valid_cols = (~smoke_mask_cols) & (~clipped_top_cols)
        osd_hit = (xs < osd_tl_x) & (ys_clean <= osd_tl_y + 2)
        valid_cols = valid_cols & (~osd_hit)

        if int(np.sum(valid_cols)) < 15:
            return {
                "ridge_pts": np.empty((0, 2), dtype=np.float64),
                "is_valid": False,
                "confidence": 0.0,
                "mean_drop": 0.0,
            }

        valid_xs = xs[valid_cols]
        valid_ys = ys_clean[valid_cols].astype(np.int32)
        drops_along_ridge = (above_s[valid_ys, valid_xs] - below_s[valid_ys, valid_xs]).astype(np.float64)
        mean_drop = float(np.mean(drops_along_ridge))
        positive_ratio = float(np.mean(drops_along_ridge >= self.min_contrast_drop * 0.6))

        confidence = float(np.clip((mean_drop / 45.0) * positive_ratio, 0.0, 1.0))
        is_valid = (
            mean_drop >= self.min_contrast_drop
            and positive_ratio >= 0.65
            and int(np.sum(valid_cols)) >= 15
        )

        if not is_valid:
            return {
                "ridge_pts": np.empty((0, 2), dtype=np.float64),
                "is_valid": False,
                "confidence": confidence,
                "mean_drop": mean_drop,
            }

        ridge_pts = np.column_stack([valid_xs.astype(np.float64), ys_clean[valid_cols]])
        return {
            "ridge_pts": ridge_pts,
            "is_valid": True,
            "confidence": confidence,
            "mean_drop": mean_drop,
        }

    def extract_ridge_points(
        self,
        frame: np.ndarray | str | Path | object,
        smoke_x_range: tuple[float, float] | list[float] | None = None,
        step_px: int | None = None,
    ) -> np.ndarray:
        """Convenience wrapper returning the (N, 2) array of ridge pixels (or empty (0, 2) if invalid)."""
        res = self.extract(frame=frame, smoke_x_range=smoke_x_range, step_px=step_px)
        return res["ridge_pts"]  # type: ignore[return-value]


def render_synthetic_cctv_frame(
    provider: object,
    true_pan: float,
    true_tilt: float,
    true_roll: float = 0.0,
    width: int = 1920,
    height: int = 1080,
    fov_h: float = 60.0,
    backlit_sky: bool = True,
    add_osd: bool = True,
    add_foreground_buildings: bool = True,
    smoke_bbox_px: list[float] | tuple[float, float, float, float] | None = None,
    channel_order: str = "RGB",
) -> tuple[np.ndarray, np.ndarray]:
    """
    Render a realistic 1920x1080 CCTV frame from a DEMProvider 3D skyline for testing and verification:
      - Supports bright white/yellow backlit sky (simulating Gachang O-ri P023/T03 haze)
      - High mountain peaks reaching y = 35~95px
      - Top-left & bottom-left OSD text overlays
      - Bright foreground buildings/roads in the lower frame
      - Rising bright smoke plume crossing above the mountain ridge inside smoke_bbox_px
    Returns (frame_uint8, gt_ridge_pts_all_cols).
    """
    # Exact pinhole rotation model projection of the DEM skyline (same model as the estimator)
    xs_all = np.arange(width, dtype=np.float64)
    ridge_y_full = provider.skyline_y_at(  # type: ignore[attr-defined]
        xs_all, true_pan, true_tilt, true_roll, width, height, fov_h
    )

    yy = np.arange(height, dtype=np.float32)[:, None]
    xx = np.arange(width, dtype=np.float32)[None, :]
    sky_mask = yy < ridge_y_full[None, :]

    img = np.zeros((height, width, 3), dtype=np.float32)

    if backlit_sky:
        # Bright white/warm-yellow backlit hazy sky (R=238, G=232, B=210)
        img[:, :, 0] = np.where(sky_mask, 238.0 - 0.03 * yy, 58.0 + 0.02 * yy)
        img[:, :, 1] = np.where(sky_mask, 232.0 - 0.03 * yy, 68.0 + 0.02 * yy)
        img[:, :, 2] = np.where(sky_mask, 210.0 - 0.02 * yy, 52.0 + 0.01 * yy)
    else:
        # Clear daytime sky
        img[:, :, 0] = np.where(sky_mask, 185.0, 52.0)
        img[:, :, 1] = np.where(sky_mask, 212.0, 66.0)
        img[:, :, 2] = np.where(sky_mask, 242.0, 48.0)

    if add_foreground_buildings:
        # Bright warehouse roofs and roads in lower valley (y > 760)
        bldg_mask = (yy > 760) & (yy < 840) & ((xx > 300) & (xx < 1500))
        img[bldg_mask] = np.array([215.0, 215.0, 220.0], dtype=np.float32)

    if smoke_bbox_px is not None:
        bx0, by0, bx1, by1 = [int(round(v)) for v in smoke_bbox_px]
        bx0, bx1 = max(0, bx0), min(width, bx1)
        by0, by1 = max(0, by0), min(height, by1)
        # Bright gray-white smoke plume rising above the ridge
        img[by0:by1, bx0:bx1, :] = 225.0

    if add_osd:
        # Top-left camera name OSD (white text with dark outline, x 12~300, y 6~34 like the Gachang O-ri feed)
        # & Bottom-left PTZ preset label OSD
        img[6:30, 12:300, :] = 250.0
        img[30:34, 12:300, :] = 15.0
        img[960:1015, 25:380, :] = 245.0

    if channel_order.upper() == "BGR":
        img = img[:, :, ::-1]

    gt_sampled = provider.synthesize_observed_skyline(  # type: ignore[attr-defined]
        true_pan=true_pan,
        true_tilt=true_tilt,
        true_roll=true_roll,
        width=width,
        height=height,
        fov_h=fov_h,
        step_px=20,
        noise_std_px=0.0,
    )
    return np.clip(img, 0, 255).astype(np.uint8), gt_sampled
