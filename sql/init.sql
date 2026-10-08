-- 녹화영상 기반 초기 스키마. 기존 DB의 구조 변경용 스크립트가 아닙니다.
-- 모든 테이블을 하나의 트랜잭션으로 생성합니다.
BEGIN;

CREATE TABLE cameras (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL CHECK (btrim(name) <> ''),
    latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE TABLE videos (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- 카메라 정보를 알 수 없는 제공 영상은 NULL을 허용합니다.
    camera_id INTEGER REFERENCES cameras(id),
    original_filename TEXT NOT NULL CHECK (btrim(original_filename) <> ''),
    file_path TEXT NOT NULL CHECK (btrim(file_path) <> ''),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE detection_events (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    video_id INTEGER NOT NULL REFERENCES videos(id),
    class TEXT NOT NULL CHECK (btrim(class) <> ''),
    -- 영상 재생 시간이 아니라 프로그램이 탐지한 실제 시각입니다.
    started_at TIMESTAMPTZ NOT NULL,
    -- 진행 중에는 NULL, 종료 시 마지막 탐지 시각을 기록합니다.
    ended_at TIMESTAMPTZ,
    max_confidence DOUBLE PRECISION NOT NULL CHECK (max_confidence BETWEEN 0 AND 1),
    estimated_latitude DOUBLE PRECISION CHECK (estimated_latitude BETWEEN -90 AND 90),
    estimated_longitude DOUBLE PRECISION CHECK (estimated_longitude BETWEEN -180 AND 180),
    error_range_m DOUBLE PRECISION CHECK (error_range_m >= 0 AND error_range_m < 'Infinity'::DOUBLE PRECISION),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- 수정 시 Backend의 UPDATE 문에서 CURRENT_TIMESTAMP로 갱신해야 합니다.
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (ended_at IS NULL OR ended_at >= started_at),
    CHECK ((estimated_latitude IS NULL) = (estimated_longitude IS NULL)),
    CHECK (error_range_m IS NULL OR estimated_latitude IS NOT NULL)
);

CREATE INDEX videos_camera_id_idx ON videos(camera_id);
CREATE INDEX detection_events_video_id_idx ON detection_events(video_id);

COMMIT;
