"""
Pinhole camera with an exact yaw(pan)-pitch(tilt)-roll rotation in the local ENU frame (X: East, Y: North, Z: Up)

Conventions (kept identical to the previous small-angle code so existing data stays valid)
  - pan: azimuth of the optical axis, degrees clockwise from true north
  - tilt: elevation of the optical axis, degrees (positive = up)
  - roll: rotation about the optical axis, degrees (positive = the right side of the horizon moves down in the image)
  - pixels: x to the right, y downward, principal point at the image center, square pixels
  - fov_h: horizontal field of view in degrees
"""
from __future__ import annotations

import math

import numpy as np


def focal_length_px(width: float, fov_h: float) -> float:
    return (width / 2.0) / math.tan(math.radians(fov_h / 2.0))


def camera_basis(pan_deg: float, tilt_deg: float, roll_deg: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (forward, right, up) unit vectors of the camera in ENU."""
    p, t, r = (math.radians(v) for v in (pan_deg, tilt_deg, roll_deg))
    fwd = np.array([math.sin(p) * math.cos(t), math.cos(p) * math.cos(t), math.sin(t)])
    right0 = np.array([math.cos(p), -math.sin(p), 0.0])
    up0 = np.cross(right0, fwd)
    right = right0 * math.cos(r) + up0 * math.sin(r)
    up = -right0 * math.sin(r) + up0 * math.cos(r)
    return fwd, right, up


def direction_vectors(az_deg, el_deg) -> np.ndarray:
    """Unit ENU vectors (..., 3) for azimuth / elevation in degrees."""
    a = np.radians(np.asarray(az_deg, dtype=np.float64))
    e = np.radians(np.asarray(el_deg, dtype=np.float64))
    return np.stack([np.sin(a) * np.cos(e), np.cos(a) * np.cos(e), np.sin(e)], axis=-1)


def pixel_to_vector(x, y, pan_deg, tilt_deg, roll_deg, width, height, fov_h) -> np.ndarray:
    """Unit ENU ray (..., 3) through pixel (x, y)."""
    f = focal_length_px(width, fov_h)
    fwd, right, up = camera_basis(pan_deg, tilt_deg, roll_deg)
    u = (np.asarray(x, dtype=np.float64) - width / 2.0) / f
    v = (height / 2.0 - np.asarray(y, dtype=np.float64)) / f
    d = fwd + u[..., None] * right + v[..., None] * up
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def pixel_to_direction(x, y, pan_deg, tilt_deg, roll_deg, width, height, fov_h):
    """(azimuth_deg in [0, 360), elevation_deg) of the ray through pixel (x, y)."""
    d = pixel_to_vector(x, y, pan_deg, tilt_deg, roll_deg, width, height, fov_h)
    az = np.degrees(np.arctan2(d[..., 0], d[..., 1])) % 360.0
    el = np.degrees(np.arcsin(np.clip(d[..., 2], -1.0, 1.0)))
    return az, el


def project_vectors(vecs, pan_deg, tilt_deg, roll_deg, width, height, fov_h):
    """Project ENU vectors (..., 3) to pixels. Returns (x, y, in_front) where in_front marks rays ahead of the camera."""
    f = focal_length_px(width, fov_h)
    fwd, right, up = camera_basis(pan_deg, tilt_deg, roll_deg)
    v = np.asarray(vecs, dtype=np.float64)
    z = v @ fwd
    in_front = z > 1e-9
    zs = np.where(in_front, z, np.nan)
    x = width / 2.0 + f * (v @ right) / zs
    y = height / 2.0 - f * (v @ up) / zs
    return x, y, in_front


def direction_to_pixel(az_deg, el_deg, pan_deg, tilt_deg, roll_deg, width, height, fov_h):
    """Project azimuth / elevation (degrees) to pixels. Returns (x, y, in_front)."""
    return project_vectors(direction_vectors(az_deg, el_deg), pan_deg, tilt_deg, roll_deg, width, height, fov_h)
