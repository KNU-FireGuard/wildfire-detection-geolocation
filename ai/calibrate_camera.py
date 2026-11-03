"""
카메라 보정 도구 명령줄 실행 (#58, docs/Camera_Calibration.md)

사용: python3 -m ai.calibrate_camera ai/config/calibration_jobs/<카메라>.json [--apply]
- 리포트·설정 후보는 data/calibration_reports/<카메라 키>/ (Git 제외)
- --apply를 줄 때만 ai/config/cameras.json에 반영
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ai.camera_calibration import (
    REPO_ROOT,
    CalibrationJobError,
    apply_config_entry,
    build_config_entry,
    calibrate_camera,
    load_calibration_job,
    write_config_candidate,
)


def _summary_markdown(job: dict, result: dict) -> str:
    lines = [f"# 카메라 보정 리포트: {job['camera']['name']} ({job['camera']['key']})", ""]
    if result["status"] != "OK":
        lines += ["- 상태: 실패", f"- 경고: {', '.join(result['warnings']) or '없음'}"]
        return "\n".join(lines) + "\n"
    lo, hi = result["fov_interval"]
    lines += [
        f"- 화각: {result['fov_h_deg']:.1f}° (최소 오차 10% 이내 구간 {lo:.1f}~{hi:.1f}°)",
        f"- 경고: {', '.join(result['warnings']) or '없음'}",
    ]
    if result.get("pan_offset"):
        po = result["pan_offset"]
        lines.append(f"- Pan 오프셋: {po['median']:.2f}° (범위 {po['min']:.2f}~{po['max']:.2f}°)")
    lines += ["", "| 화면 | Pan | Tilt | Roll | 능선 잔차 |", "| :--- | ---: | ---: | ---: | ---: |"]
    for vid, v in result["views"].items():
        lines.append(f"| {vid} | {v['pan']:.2f}° | {v['tilt']:.2f}° | {v['roll']:+.2f}° | {v['rms_deg']:.3f}° |")
    if result.get("validation"):
        lines += ["", "| 검증용 랜드마크 | 각도 오차 | 거리 | 옆 방향 오차 |", "| :--- | ---: | ---: | ---: |"]
        for v in result["validation"]:
            lines.append(f"| {v['name']} | {v['error_deg']:.2f}° | {v['distance_m']:.0f}m | {v['lateral_m']:+.1f}m |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="FireGuard 카메라 보정 도구")
    parser.add_argument("job", type=Path, help="보정 작업 파일 (ai/config/calibration_jobs/*.json)")
    parser.add_argument("--base-dir", type=Path, default=REPO_ROOT, help="프레임 경로 기준 폴더 (기본: 저장소 루트)")
    parser.add_argument("--out-dir", type=Path, default=None, help="리포트 저장 폴더 (기본: data/calibration_reports/<키>)")
    parser.add_argument("--config", type=Path, default=None, help="반영할 설정 파일 (기본: ai/config/cameras.json)")
    parser.add_argument("--apply", action="store_true", help="설정 파일에 반영")
    args = parser.parse_args(argv)

    try:
        job = load_calibration_job(args.job, base_dir=args.base_dir)
    except CalibrationJobError as exc:
        print(f"보정 작업 파일 오류: {exc}", file=sys.stderr)
        return 2

    result = calibrate_camera(job)
    out_dir = args.out_dir or (REPO_ROOT / "data" / "calibration_reports" / job["camera"]["key"])
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {k: v for k, v in result.items()}
    (out_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=list) + "\n",
                                         encoding="utf-8")
    summary = _summary_markdown(job, result)
    (out_dir / "report.md").write_text(summary, encoding="utf-8")
    print(summary)

    if result["status"] != "OK":
        print("보정 실패: 설정 후보를 만들지 않음", file=sys.stderr)
        return 1
    entry = build_config_entry(job, result)
    candidate = write_config_candidate(entry, out_dir / "candidate.json")
    print(f"설정 후보: {candidate}")
    if args.apply:
        print(f"설정 반영: {apply_config_entry(entry, args.config)}")
    else:
        print("설정 파일은 바꾸지 않음 (반영하려면 --apply)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
