BEGIN;
CREATE TABLE IF NOT EXISTS event_captures (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES detection_events(id) ON DELETE CASCADE,
    video_time_ms BIGINT NOT NULL CHECK (video_time_ms >= 0),
    jpeg BYTEA NOT NULL CHECK (octet_length(jpeg) BETWEEN 4 AND 2097152),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id, video_time_ms)
);
COMMIT;
