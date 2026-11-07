"""시간 기반 프레임 선택과 같은 영역의 20프레임 중 16회 탐지 판정."""
import math
from collections import deque


class FrameSampler:
    def __init__(self, fps=5):
        self.interval = 1 / fps
        self.next_at = None
        self.last_at = None

    def accept(self, timestamp):
        if self.last_at is not None and timestamp < self.last_at:
            self.next_at = None
        self.last_at = timestamp
        if self.next_at is None:
            self.next_at = timestamp
        if timestamp + 1e-6 < self.next_at:
            return False
        steps = math.floor((timestamp - self.next_at + 1e-6) / self.interval) + 1
        self.next_at += max(1, steps) * self.interval
        return True


def box_iou(a, b):
    intersection = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])
    union = area_a + area_b - intersection
    return intersection / union if union else 0


class TemporalDetectionGate:
    # IoU 0.2: 연기 박스의 성장·흔들림을 허용하는 초기 연결 기준
    def __init__(self):
        self.reset()

    def reset(self):
        self.timestamps = deque(maxlen=20)
        self.tracks = []

    def update(self, timestamp, detections):
        if self.timestamps and not 0 < timestamp - self.timestamps[-1] <= 0.4 + 1e-6:
            self.reset()
        self.timestamps.append(timestamp)
        for track in self.tracks:
            track["votes"].append(0)

        # 가장 많이 겹치는 같은 클래스의 박스를 일대일로 연결
        matches = []
        for index, detection in enumerate(detections):
            for track_index, track in enumerate(self.tracks):
                if track["class"] == detection["class"]:
                    overlap = box_iou(track["bbox"], detection["bbox"])
                    if overlap >= 0.2:
                        matches.append((overlap, index, track_index))
        assigned = {}
        used_tracks = set()
        for _, index, track_index in sorted(matches, reverse=True):
            if index not in assigned and track_index not in used_tracks:
                assigned[index] = self.tracks[track_index]
                used_tracks.add(track_index)
        for index, detection in enumerate(detections):
            track = assigned.get(index)
            if track is None:
                track = {
                    "class": detection["class"], "bbox": detection["bbox"],
                    "votes": deque([0] * len(self.timestamps), maxlen=20),
                }
                self.tracks.append(track)
                assigned[index] = track
            track["bbox"] = detection["bbox"]
            track["votes"][-1] = 1

        self.tracks = [track for track in self.tracks if any(track["votes"])]
        if len(self.timestamps) < 20 or not 3.6 <= self.timestamps[-1] - self.timestamps[0] <= 4.2:
            return []
        # 현재 프레임에 보이는 영역만 전송하고 이전 좌표를 재사용하지 않음
        return [index for index, track in assigned.items() if sum(track["votes"]) >= 16]
