"""카메라별 보정 설정 (#57, ADR 0018)"""
from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from ai.camera_config import CameraConfigError, find_camera_config, load_camera_configs

VALID = {
    "version": 1,
    "cameras": [
        {
            "key": "gachang-ori",
            "name": "가창오리",
            "camera_id": None,
            "fov_h_deg": 52.0,
            "ptz": {"pan_offset_deg": 119.4, "presets": {"P339/T03": {"pan": 99.0, "tilt": 0.5, "roll": 1.6}}},
            "provenance": "test",
        },
        {
            "key": "fixed-cam",
            "name": "고정카메라",
            "camera_id": 3,
            "fov_h_deg": 48.0,
            "fixed_pose": {"pan": 120.0, "tilt": 2.0, "roll": 0.0},
        },
    ],
}


class TestCameraConfigLoader(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(self.dir, ignore_errors=True))

    def _write(self, data: object) -> Path:
        p = self.dir / "cameras.json"
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return p

    def test_missing_file_gives_empty_config(self) -> None:
        self.assertEqual(load_camera_configs(self.dir / "none.json"), [])

    def test_valid_file_is_loaded_and_found_by_name_or_id(self) -> None:
        cfgs = load_camera_configs(self._write(VALID))
        self.assertEqual(len(cfgs), 2)
        self.assertEqual(find_camera_config(cfgs, name="가창오리")["key"], "gachang-ori")
        self.assertEqual(find_camera_config(cfgs, camera_id=3)["key"], "fixed-cam")
        self.assertIsNone(find_camera_config(cfgs, name="없는카메라"))

    def test_preset_and_fixed_pose_are_available(self) -> None:
        cfgs = load_camera_configs(self._write(VALID))
        self.assertAlmostEqual(find_camera_config(cfgs, name="가창오리")["ptz"]["presets"]["P339/T03"]["pan"], 99.0)
        self.assertAlmostEqual(find_camera_config(cfgs, camera_id=3)["fixed_pose"]["pan"], 120.0)

    def test_invalid_fov_is_rejected(self) -> None:
        bad = json.loads(json.dumps(VALID))
        bad["cameras"][0]["fov_h_deg"] = 0.0
        with self.assertRaises(CameraConfigError):
            load_camera_configs(self._write(bad))

    def test_missing_key_is_rejected(self) -> None:
        bad = json.loads(json.dumps(VALID))
        del bad["cameras"][1]["key"]
        with self.assertRaises(CameraConfigError):
            load_camera_configs(self._write(bad))

    def test_duplicate_identity_is_rejected(self) -> None:
        bad = json.loads(json.dumps(VALID))
        bad["cameras"][1]["name"] = "가창오리"
        with self.assertRaises(CameraConfigError):
            load_camera_configs(self._write(bad))

    def test_incomplete_pose_is_rejected(self) -> None:
        bad = json.loads(json.dumps(VALID))
        bad["cameras"][1]["fixed_pose"] = {"pan": 120.0}
        with self.assertRaises(CameraConfigError):
            load_camera_configs(self._write(bad))


class TestEstimatorUsesCameraConfig(unittest.TestCase):
    """추정기: 메타데이터 > 설정 파일 > 기본값, 프리셋·라벨 변환"""

    CAM = {"lat": 35.791037, "lon": 128.591184, "tower_height": 15.0, "near_m": 30.0, "name": "가창오리"}
    BBOX = [1000.0, 640.0, 1080.0, 740.0]

    def _estimate(self, ptz: dict, cam_extra: dict | None = None) -> dict:
        from ai.fire_location_estimator import FireLocationEstimator

        cfgs = [dict(VALID["cameras"][0])]
        cfgs[0]["ptz"] = {"pan_offset_deg": 119.4, "presets": {"P339/T03": {"pan": 99.0, "tilt": 0.5, "roll": 1.6}}}
        est = FireLocationEstimator(camera_configs=cfgs)
        cam = {**self.CAM, **(cam_extra or {})}
        return est.estimate_location(
            self.BBOX, {"camera": cam, "ptz": ptz}, use_skyline_calibration=False, bbox_normalized=False
        )

    def test_preset_label_uses_configured_pose_and_fov(self) -> None:
        res = self._estimate({"preset": "P339/T03"})
        self.assertEqual(res["status"], "OK")
        self.assertAlmostEqual(res["calibration"]["pan"], 99.0)
        self.assertAlmostEqual(res["calibration"]["tilt"], 0.5)
        self.assertEqual(res["calibration"]["mode"], "config_preset")
        self.assertEqual(res["camera_config"]["key"], "gachang-ori")
        self.assertEqual(res["camera_config"]["fov_source"], "config")
        self.assertAlmostEqual(res["camera_config"]["fov_h_deg"], 52.0)

    def test_raw_label_pan_is_converted_with_offset(self) -> None:
        res = self._estimate({"label_pan": 339.0, "label_tilt": 3.0})
        self.assertAlmostEqual(res["calibration"]["pan"], (339.0 + 119.4) % 360.0)
        self.assertAlmostEqual(res["calibration"]["tilt"], 3.0)
        self.assertEqual(res["calibration"]["mode"], "label_offset")

    def test_explicit_metadata_fov_overrides_config(self) -> None:
        res = self._estimate({"preset": "P339/T03"}, {"fov_h": 47.0})
        self.assertEqual(res["camera_config"]["fov_source"], "metadata")
        self.assertAlmostEqual(res["camera_config"]["fov_h_deg"], 47.0)

    def test_unknown_preset_is_reported_without_location(self) -> None:
        res = self._estimate({"preset": "P999/T00"})
        self.assertEqual(res["status"], "UNKNOWN_PRESET")
        self.assertIsNone(res["location_estimation"])


class TestUncalibratedCameraIsFlagged(unittest.TestCase):
    """보정 설정도 명시 화각도 없으면 기본 화각 사용을 결과에 경고로 표시"""

    def _estimate(self, cam_extra: dict, configs: list[dict]) -> dict:
        from ai.fire_location_estimator import FireLocationEstimator

        cam = {"lat": 35.791037, "lon": 128.591184, "tower_height": 15.0, "near_m": 30.0, **cam_extra}
        return FireLocationEstimator(camera_configs=configs).estimate_location(
            [1000.0, 640.0, 1080.0, 740.0],
            {"camera": cam, "ptz": {"pan": 99.0, "tilt": 0.5, "roll": 0.0}},
            use_skyline_calibration=False,
            bbox_normalized=False,
        )

    def test_unknown_camera_without_fov_is_flagged(self) -> None:
        res = self._estimate({"name": "미등록카메라"}, [])
        self.assertFalse(res["camera_config"]["calibrated"])
        self.assertIn("FOV_DEFAULT_USED", res["camera_config"]["warnings"])

    def test_configured_camera_is_not_flagged(self) -> None:
        res = self._estimate({"name": "가창오리"}, [dict(VALID["cameras"][0])])
        self.assertTrue(res["camera_config"]["calibrated"])
        self.assertEqual(res["camera_config"]["warnings"], [])

    def test_explicit_fov_without_config_is_not_a_default_warning(self) -> None:
        res = self._estimate({"name": "미등록카메라", "fov_h": 50.0}, [])
        self.assertFalse(res["camera_config"]["calibrated"])
        self.assertNotIn("FOV_DEFAULT_USED", res["camera_config"]["warnings"])


class TestShippedCameraConfig(unittest.TestCase):
    """저장소에 포함된 ai/config/cameras.json이 유효하고 가창오리 보정값을 담고 있어야 함"""

    def test_gachang_entry_is_present_and_consistent(self) -> None:
        cfgs = load_camera_configs()
        cam = find_camera_config(cfgs, name="가창오리")
        self.assertIsNotNone(cam)
        self.assertTrue(40.0 <= cam["fov_h_deg"] <= 60.0)
        presets = cam["ptz"]["presets"]
        self.assertEqual(set(presets), {"P269/T13", "P339/T03", "P023/T03", "P070/T03", "P107/T03", "P133/T03"})
        # 프리셋 자세의 Pan은 라벨 + Pan 오프셋과 ±3° 이내로 일관
        offset = cam["ptz"]["pan_offset_deg"]
        for label, pose in presets.items():
            label_pan = float(label[1:4])
            diff = ((pose["pan"] - (label_pan + offset)) + 180.0) % 360.0 - 180.0
            self.assertLess(abs(diff), 3.0, f"{label}: {diff:+.2f}°")
        self.assertIn("provenance", cam)


if __name__ == "__main__":
    unittest.main()
