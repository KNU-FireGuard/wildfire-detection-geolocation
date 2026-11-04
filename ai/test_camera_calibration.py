"""카메라 보정 도구 (#58, docs/Camera_Calibration.md)"""
from __future__ import annotations

import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from ai.camera_calibration import CalibrationJobError, load_calibration_job

JOB = {
    "version": 1,
    "camera": {"key": "test-cam", "name": "테스트", "camera_id": None, "lat": 35.791037, "lon": 128.591184},
    "fov_search_deg": [40.0, 60.0],
    "fov_step_deg": 2.0,
    "views": [
        {"id": "V1", "frame": "frames/v1.png", "preset": "P339/T03", "label_pan": 339.0},
        {"id": "V2", "frame": "frames/v2.png"},
    ],
    "landmarks": [
        {"name": "A", "lat": 35.7911, "lon": 128.5920, "height_m": 6.0, "view": "V1", "px": [600, 875], "use": "fit"},
        {"name": "E", "lat": 35.7903, "lon": 128.5938, "view": "V1", "px": [1200, 905], "use": "val"},
    ],
}


class TestCalibrationJobLoader(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(self.dir, ignore_errors=True))

    def _write(self, data: dict) -> Path:
        p = self.dir / "job.json"
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return p

    def test_valid_job_is_loaded_with_defaults_and_resolved_paths(self) -> None:
        job = load_calibration_job(self._write(JOB), base_dir=self.dir)
        self.assertEqual(job["camera"]["key"], "test-cam")
        self.assertEqual(job["views"][0]["frame"], self.dir / "frames/v1.png")
        self.assertEqual(job["landmarks"][1]["height_m"], 0.0)
        self.assertEqual([lm["use"] for lm in job["landmarks"]], ["fit", "val"])

    def _assert_rejected(self, mutate) -> None:
        bad = copy.deepcopy(JOB)
        mutate(bad)
        with self.assertRaises(CalibrationJobError):
            load_calibration_job(self._write(bad), base_dir=self.dir)

    def test_missing_camera_coordinate_is_rejected(self) -> None:
        self._assert_rejected(lambda j: j["camera"].pop("lat"))

    def test_landmark_on_unknown_view_is_rejected(self) -> None:
        self._assert_rejected(lambda j: j["landmarks"][0].update(view="V9"))

    def test_invalid_landmark_use_is_rejected(self) -> None:
        self._assert_rejected(lambda j: j["landmarks"][0].update(use="both"))

    def test_invalid_fov_range_is_rejected(self) -> None:
        self._assert_rejected(lambda j: j.update(fov_search_deg=[60.0, 40.0]))

    def test_duplicate_view_id_is_rejected(self) -> None:
        self._assert_rejected(lambda j: j["views"][1].update(id="V1"))

    def test_empty_views_are_rejected(self) -> None:
        self._assert_rejected(lambda j: j.update(views=[], landmarks=[]))


TRUE_FOV = 50.0
TRUE_POSES = {"V1": (99.2, 1.3, 0.8), "V2": (141.8, 2.6, 1.5)}
LABELS = {"V1": 339.0, "V2": 23.0}  # 라벨 + 120.2° ≈ 실제 Pan


class SyntheticCalibrationCase(unittest.TestCase):
    """정답(화각·자세)을 아는 합성 프레임으로 보정 도구 검증"""

    @classmethod
    def setUpClass(cls) -> None:
        from PIL import Image

        from ai.dem_skyline_engine import DEMProvider
        from ai.ridge_detector import render_synthetic_cctv_frame

        cls.dir = Path(tempfile.mkdtemp())
        cls.provider = DEMProvider()
        for vid, pose in TRUE_POSES.items():
            frame, _ = render_synthetic_cctv_frame(cls.provider, *pose, fov_h=TRUE_FOV, add_osd=True)
            Image.fromarray(frame).save(cls.dir / f"{vid}.png")

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.dir, ignore_errors=True)

    def _job(self, landmarks: list[dict] | None = None, fov=(44.0, 56.0), step=2.0, views=("V1", "V2")) -> dict:
        data = {
            "version": 1,
            "camera": {"key": "syn", "name": "합성", "lat": 35.791037, "lon": 128.591184, "tower_height_m": 15.0},
            "fov_search_deg": list(fov),
            "fov_step_deg": step,
            "views": [{"id": v, "frame": f"{v}.png", "preset": f"{v}-preset", "label_pan": LABELS[v]} for v in views],
            "landmarks": landmarks or [],
        }
        p = self.dir / "job.json"
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return load_calibration_job(p, base_dir=self.dir)


def make_landmarks(provider, view: str, pose: tuple, fov: float, use: str, offsets=(-15.0, 0.0, 15.0), dist_m=600.0):
    """카메라에서 (Pan + 오프셋) 방향 dist_m 지점의 지면 점을 주어진 자세·화각으로 투영해 랜드마크 생성"""
    import math as _m

    from ai.camera_model import direction_to_pixel
    from ai.dem_skyline_engine import dest_point

    lms = []
    for i, off in enumerate(offsets):
        la, lo = dest_point(provider.cam_lat, provider.cam_lon, (pose[0] + off) % 360.0, dist_m)
        dz = float(provider.get_elevation(la, lo)) - provider.eye_alt
        el = _m.degrees(_m.atan2(dz, dist_m))
        x, y, _ = direction_to_pixel((pose[0] + off) % 360.0, el, *pose, 1920, 1080, fov)
        lms.append({"name": f"{view}-{use}-{i}", "lat": la, "lon": lo, "height_m": 0.0,
                    "view": view, "px": [float(x), float(y)], "use": use})
    return lms


class TestFitLandmarkConstraint(SyntheticCalibrationCase):
    """보정용(fit) 랜드마크가 화각·자세 추정에 실제로 반영되어야 함"""

    def test_consistent_landmarks_keep_true_fov_with_small_error(self) -> None:
        from ai.camera_calibration import calibrate_camera

        lms = make_landmarks(self.provider, "V1", TRUE_POSES["V1"], TRUE_FOV, "fit")
        res = calibrate_camera(self._job(lms), provider=self.provider)
        self.assertAlmostEqual(res["fov_h_deg"], TRUE_FOV, delta=1.0)
        self.assertEqual(len(res["fit_landmarks"]), 3)
        for lm in res["fit_landmarks"]:
            self.assertLess(lm["error_deg"], 0.3, lm["name"])

    def test_conflicting_landmarks_pull_fov(self) -> None:
        """다른 화각(44°)에 맞춘 랜드마크를 넣으면 결과 화각이 능선만 쓸 때보다 44° 쪽으로 이동"""
        from ai.camera_calibration import calibrate_camera

        ridge_only = calibrate_camera(self._job(), provider=self.provider)["fov_h_deg"]
        lms = make_landmarks(self.provider, "V1", TRUE_POSES["V1"], 44.0, "fit", offsets=(-20.0, -10.0, 10.0, 20.0))
        with_lms = calibrate_camera(self._job(lms), provider=self.provider)["fov_h_deg"]
        self.assertLess(with_lms, ridge_only)


class TestValidationLandmarkReport(SyntheticCalibrationCase):
    """검증용(val) 랜드마크: 보정에 쓰지 않고 오차만 보고"""

    def test_validation_errors_are_reported(self) -> None:
        from ai.camera_calibration import calibrate_camera

        vals = make_landmarks(self.provider, "V2", TRUE_POSES["V2"], TRUE_FOV, "val", offsets=(-12.0, 12.0))
        res = calibrate_camera(self._job(vals), provider=self.provider)
        self.assertEqual(len(res["validation"]), 2)
        for v in res["validation"]:
            self.assertLess(v["error_deg"], 0.3, v["name"])
            self.assertLess(abs(v["lateral_m"]), 5.0, v["name"])
            self.assertGreater(v["distance_m"], 500.0)

    def test_validation_landmarks_do_not_affect_calibration(self) -> None:
        """검증용 랜드마크 좌표를 크게 틀리게 바꿔도 화각·자세는 같고 보고 오차만 커짐 (순환 검증 방지)"""
        from ai.camera_calibration import calibrate_camera

        vals = make_landmarks(self.provider, "V2", TRUE_POSES["V2"], TRUE_FOV, "val", offsets=(-12.0, 12.0))
        good = calibrate_camera(self._job(vals), provider=self.provider)
        moved = copy.deepcopy(vals)
        for lm in moved:
            lm["lon"] += 0.003  # 약 270m 동쪽으로 이동
        bad = calibrate_camera(self._job(moved), provider=self.provider)
        self.assertEqual(good["fov_h_deg"], bad["fov_h_deg"])
        for vid in TRUE_POSES:
            self.assertEqual(good["views"][vid]["pan"], bad["views"][vid]["pan"])
            self.assertEqual(good["views"][vid]["tilt"], bad["views"][vid]["tilt"])
        self.assertGreater(max(v["error_deg"] for v in bad["validation"]), 5.0)


class TestCalibrationWarnings(SyntheticCalibrationCase):
    """docs/Camera_Calibration.md 경고 표"""

    def test_no_landmarks_warns(self) -> None:
        from ai.camera_calibration import calibrate_camera

        res = calibrate_camera(self._job(), provider=self.provider)
        self.assertIn("NO_LANDMARKS", res["warnings"])
        self.assertIn("NO_VALIDATION_LANDMARKS", res["warnings"])

    def test_clustered_fit_landmarks_warn_position_unconstrained(self) -> None:
        from ai.camera_calibration import calibrate_camera

        lms = make_landmarks(self.provider, "V1", TRUE_POSES["V1"], TRUE_FOV, "fit", offsets=(-10.0, 0.0, 10.0))
        res = calibrate_camera(self._job(lms, views=("V1",)), provider=self.provider)
        self.assertIn("POSITION_UNCONSTRAINED", res["warnings"])
        self.assertNotIn("NO_LANDMARKS", res["warnings"])

    def test_spread_fit_landmarks_do_not_warn_position(self) -> None:
        from ai.camera_calibration import calibrate_camera

        lms = make_landmarks(self.provider, "V1", TRUE_POSES["V1"], TRUE_FOV, "fit", offsets=(-20.0, 20.0))
        lms += make_landmarks(self.provider, "V2", TRUE_POSES["V2"], TRUE_FOV, "fit", offsets=(-20.0, 20.0))
        res = calibrate_camera(self._job(lms), provider=self.provider)
        self.assertNotIn("POSITION_UNCONSTRAINED", res["warnings"])

    def test_inconsistent_pan_offset_warns(self) -> None:
        from ai.camera_calibration import calibrate_camera

        job = self._job()
        job["views"][1]["label_pan"] = 18.0  # 오프셋 123.8° vs 120.2°, 차이 3.6°
        res = calibrate_camera(job, provider=self.provider)
        self.assertIn("PAN_OFFSET_INCONSISTENT", res["warnings"])

    def test_unsatisfiable_fit_landmarks_warn_residual_high(self) -> None:
        """
        능선과 맞지 않는 보정용 랜드마크는 오차가 커서 경고, 일관된 랜드마크는 경고 없음
        카메라 위치 오차처럼 방향마다 다르게 어긋나도록 좌우 랜드마크를 ±150px 엇갈려 밀림
        (모두 같은 방향으로 밀면 Pan 회전으로 흡수되어 이 경고로는 구분 불가)
        """
        from ai.camera_calibration import calibrate_camera

        good = make_landmarks(self.provider, "V1", TRUE_POSES["V1"], TRUE_FOV, "fit", offsets=(-20.0, 20.0))
        good += make_landmarks(self.provider, "V2", TRUE_POSES["V2"], TRUE_FOV, "fit", offsets=(-20.0, 20.0))
        bad = copy.deepcopy(good)
        for i, lm in enumerate(bad):
            lm["px"][0] += 150.0 if i % 2 == 0 else -150.0
        self.assertNotIn("LANDMARK_RESIDUAL_HIGH", calibrate_camera(self._job(good), provider=self.provider)["warnings"])
        self.assertIn("LANDMARK_RESIDUAL_HIGH", calibrate_camera(self._job(bad), provider=self.provider)["warnings"])

    def test_flat_fov_curve_is_ill_constrained(self) -> None:
        from ai.camera_calibration import fov_interval

        sharp = [(46.0, 0.01), (48.0, 0.004), (50.0, 0.001), (52.0, 0.004), (54.0, 0.01)]
        flat = [(40.0, 0.0105), (44.0, 0.0102), (48.0, 0.0100), (52.0, 0.0101), (56.0, 0.0104)]
        self.assertEqual(fov_interval(sharp), ((50.0, 50.0), False))
        interval, ill = fov_interval(flat)
        self.assertTrue(ill)
        self.assertGreaterEqual(interval[1] - interval[0], 6.0)


class TestConfigCandidate(SyntheticCalibrationCase):
    """보정 결과 → ai/config/cameras.json 항목 (ADR 0018)"""

    def test_preset_camera_entry_passes_config_loader(self) -> None:
        from ai.camera_calibration import build_config_entry, calibrate_camera, write_config_candidate
        from ai.camera_config import find_camera_config, load_camera_configs

        job = self._job()
        res = calibrate_camera(job, provider=self.provider)
        entry = build_config_entry(job, res)
        out = self.dir / "candidate.json"
        write_config_candidate(entry, out)
        cam = find_camera_config(load_camera_configs(out), name="합성")
        self.assertAlmostEqual(cam["fov_h_deg"], res["fov_h_deg"])
        self.assertAlmostEqual(cam["ptz"]["presets"]["V1-preset"]["pan"], round(res["views"]["V1"]["pan"], 2))
        self.assertAlmostEqual(cam["ptz"]["pan_offset_deg"], round(res["pan_offset"]["median"], 2))
        self.assertIn("warnings", cam["uncertainty"])
        self.assertIn("fov_interval_deg", cam["uncertainty"])

    def test_fixed_camera_entry_uses_fixed_pose(self) -> None:
        from ai.camera_calibration import build_config_entry, calibrate_camera

        job = self._job(views=("V1",))
        job["views"][0]["preset"] = None
        job["views"][0].pop("label_pan", None)
        res = calibrate_camera(job, provider=self.provider)
        entry = build_config_entry(job, res)
        self.assertNotIn("ptz", entry)
        self.assertAlmostEqual(entry["fixed_pose"]["pan"], round(res["views"]["V1"]["pan"], 2))

    def test_apply_replaces_same_key_and_keeps_other_cameras(self) -> None:
        from ai.camera_calibration import apply_config_entry
        from ai.camera_config import find_camera_config, load_camera_configs

        cfg = self.dir / "cameras.json"
        cfg.write_text(json.dumps({"version": 1, "cameras": [
            {"key": "other", "name": "다른카메라", "fov_h_deg": 60.0},
            {"key": "syn", "name": "합성", "fov_h_deg": 60.0},
        ]}, ensure_ascii=False), encoding="utf-8")
        apply_config_entry({"key": "syn", "name": "합성", "camera_id": None, "fov_h_deg": 49.0}, cfg)
        cams = load_camera_configs(cfg)
        self.assertEqual(len(cams), 2)
        self.assertAlmostEqual(find_camera_config(cams, name="합성")["fov_h_deg"], 49.0)
        self.assertAlmostEqual(find_camera_config(cams, name="다른카메라")["fov_h_deg"], 60.0)

    def test_failed_calibration_cannot_become_entry(self) -> None:
        from ai.camera_calibration import CalibrationJobError, build_config_entry

        with self.assertRaises(CalibrationJobError):
            build_config_entry(self._job(), {"status": "FAILED", "views": {}, "warnings": []})


class TestCalibrationCli(SyntheticCalibrationCase):
    """python3 -m ai.calibrate_camera: 리포트·후보 저장, --apply일 때만 설정 반영"""

    def _run(self, *extra: str):
        import subprocess
        import sys

        self._job()  # job.json 생성
        return subprocess.run(
            [sys.executable, "-m", "ai.calibrate_camera", str(self.dir / "job.json"),
             "--base-dir", str(self.dir), "--out-dir", str(self.dir / "out"), *extra],
            cwd=Path(__file__).resolve().parent.parent, capture_output=True, text=True,
        )

    def test_cli_writes_report_and_candidate_without_touching_config(self) -> None:
        cfg = self.dir / "cfg.json"
        cfg.write_text(json.dumps({"version": 1, "cameras": []}), encoding="utf-8")
        proc = self._run("--config", str(cfg))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        for name in ("report.json", "report.md", "candidate.json"):
            self.assertTrue((self.dir / "out" / name).exists(), name)
        self.assertEqual(json.loads(cfg.read_text(encoding="utf-8"))["cameras"], [])
        self.assertIn("화각", proc.stdout)

    def test_cli_apply_updates_config(self) -> None:
        cfg = self.dir / "cfg_apply.json"
        cfg.write_text(json.dumps({"version": 1, "cameras": []}), encoding="utf-8")
        proc = self._run("--config", str(cfg), "--apply")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        cams = json.loads(cfg.read_text(encoding="utf-8"))["cameras"]
        self.assertEqual([c["key"] for c in cams], ["syn"])

    def test_cli_rejects_invalid_job_with_nonzero_exit(self) -> None:
        import subprocess
        import sys

        bad = self.dir / "bad.json"
        bad.write_text(json.dumps({"camera": {}}), encoding="utf-8")
        proc = subprocess.run([sys.executable, "-m", "ai.calibrate_camera", str(bad)],
                              cwd=Path(__file__).resolve().parent.parent, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("보정 작업 파일 오류", proc.stderr)


class TestFovAndPoseRecovery(SyntheticCalibrationCase):
    def test_recovers_fov_and_view_poses_from_ridges(self) -> None:
        from ai.camera_calibration import calibrate_camera

        res = calibrate_camera(self._job(), provider=self.provider)
        self.assertAlmostEqual(res["fov_h_deg"], TRUE_FOV, delta=2.0)
        for vid, (pan, tilt, roll) in TRUE_POSES.items():
            v = res["views"][vid]
            self.assertAlmostEqual(v["pan"], pan, delta=0.5, msg=vid)
            self.assertAlmostEqual(v["tilt"], tilt, delta=0.5, msg=vid)
        self.assertAlmostEqual(res["pan_offset"]["median"], 120.2, delta=1.0)
        self.assertEqual(len(res["fov_curve"]), 7)


if __name__ == "__main__":
    unittest.main()
