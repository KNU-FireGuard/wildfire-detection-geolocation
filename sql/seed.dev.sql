-- 개발용 CCTV와 녹화 영상 메타데이터. 실제 영상 파일은 Git에 포함하지 않습니다.
-- 프로젝트 루트에서 실행합니다. 각 file_path에 해당하는 파일을 data/videos/에 준비하세요.
-- 이미 다른 파일명으로 영상을 등록한 카메라는 그 등록을 유지하므로 해당 파일명을 그대로 사용하면 됩니다.
BEGIN;

INSERT INTO cameras (name, source_type, latitude, longitude)
SELECT source.name, 'test', source.latitude, source.longitude
FROM (VALUES
    ('경북의성', 36.368431::DOUBLE PRECISION, 128.572611::DOUBLE PRECISION),
    ('청성', 36.270014::DOUBLE PRECISION, 127.749227::DOUBLE PRECISION),
    ('기도4교', 36.382015::DOUBLE PRECISION, 128.577886::DOUBLE PRECISION),
    ('단촌4터널', 36.421821::DOUBLE PRECISION, 128.724045::DOUBLE PRECISION)
) AS source(name, latitude, longitude)
WHERE NOT EXISTS (
    SELECT 1 FROM cameras AS existing
    WHERE existing.name = source.name AND existing.source_type = 'test'
);

UPDATE cameras AS camera
SET latitude = source.latitude,
    longitude = source.longitude
FROM (VALUES
    ('경북의성', 36.368431::DOUBLE PRECISION, 128.572611::DOUBLE PRECISION),
    ('청성', 36.270014::DOUBLE PRECISION, 127.749227::DOUBLE PRECISION),
    ('기도4교', 36.382015::DOUBLE PRECISION, 128.577886::DOUBLE PRECISION),
    ('단촌4터널', 36.421821::DOUBLE PRECISION, 128.724045::DOUBLE PRECISION)
) AS source(name, latitude, longitude)
WHERE camera.name = source.name AND camera.source_type = 'test';

-- 카메라에 이미 영상이 있으면(다른 파일명으로 등록한 경우 포함) 새 행을 만들지 않고 그대로 둡니다.
INSERT INTO videos (camera_id, original_filename, file_path)
SELECT camera.id, source.original_filename, source.file_path
FROM (VALUES
    ('경북의성', '경북의성.mp4', 'data/videos/경북의성.mp4'),
    ('청성', '청성.mp4', 'data/videos/청성.mp4'),
    ('기도4교', '기도4교.mp4', 'data/videos/기도4교.mp4'),
    ('단촌4터널', '단촌4터널.mp4', 'data/videos/단촌4터널.mp4')
) AS source(camera_name, original_filename, file_path)
CROSS JOIN LATERAL (
    SELECT id FROM cameras
    WHERE name = source.camera_name AND source_type = 'test'
    ORDER BY id LIMIT 1
) AS camera
WHERE NOT EXISTS (
    SELECT 1 FROM videos AS existing
    WHERE existing.file_path = source.file_path OR existing.camera_id = camera.id
);

UPDATE videos AS video
SET camera_id = (
        SELECT camera.id FROM cameras AS camera
        WHERE camera.name = source.camera_name AND camera.source_type = 'test'
        ORDER BY camera.id LIMIT 1
    ),
    original_filename = source.original_filename
FROM (VALUES
    ('경북의성', '경북의성.mp4', 'data/videos/경북의성.mp4'),
    ('청성', '청성.mp4', 'data/videos/청성.mp4'),
    ('기도4교', '기도4교.mp4', 'data/videos/기도4교.mp4'),
    ('단촌4터널', '단촌4터널.mp4', 'data/videos/단촌4터널.mp4')
) AS source(camera_name, original_filename, file_path)
WHERE video.file_path = source.file_path;

COMMIT;
