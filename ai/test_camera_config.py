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
