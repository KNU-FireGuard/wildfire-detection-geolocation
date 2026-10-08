-- 개발용 CCTV와 녹화 영상 메타데이터. 실제 영상 파일은 Git에 포함하지 않습니다.
-- 프로젝트 루트에서 실행합니다. 각 file_path에 해당하는 파일을 data/videos/에 준비하세요.
BEGIN;

INSERT INTO cameras (name, latitude, longitude)
SELECT source.name, source.latitude, source.longitude
FROM (VALUES
    ('경북의성', 36.368431::DOUBLE PRECISION, 128.572611::DOUBLE PRECISION),
    ('청성', 36.270014::DOUBLE PRECISION, 127.749227::DOUBLE PRECISION),
    ('기도4교', 36.382015::DOUBLE PRECISION, 128.577886::DOUBLE PRECISION),
    ('단촌4터널', 36.416183::DOUBLE PRECISION, 128.752453::DOUBLE PRECISION)
) AS source(name, latitude, longitude)
WHERE NOT EXISTS (
    SELECT 1 FROM cameras AS existing WHERE existing.name = source.name
);

UPDATE cameras AS camera
SET latitude = source.latitude,
    longitude = source.longitude
FROM (VALUES
    ('경북의성', 36.368431::DOUBLE PRECISION, 128.572611::DOUBLE PRECISION),
    ('청성', 36.270014::DOUBLE PRECISION, 127.749227::DOUBLE PRECISION),
    ('기도4교', 36.382015::DOUBLE PRECISION, 128.577886::DOUBLE PRECISION),
    ('단촌4터널', 36.416183::DOUBLE PRECISION, 128.752453::DOUBLE PRECISION)
) AS source(name, latitude, longitude)
WHERE camera.name = source.name;

INSERT INTO videos (camera_id, original_filename, file_path)
SELECT
    (SELECT camera.id FROM cameras AS camera WHERE camera.name = source.camera_name ORDER BY camera.id LIMIT 1),
    source.original_filename,
    source.file_path
FROM (VALUES
    ('경북의성', '경북의성.mp4', 'data/videos/경북의성.mp4'),
    ('청성', '청성.mp4', 'data/videos/청성.mp4'),
    ('기도4교', '기도4교.mp4', 'data/videos/기도4교.mp4'),
    ('단촌4터널', '단촌4터널.mp4', 'data/videos/단촌4터널.mp4')
) AS source(camera_name, original_filename, file_path)
WHERE NOT EXISTS (
    SELECT 1 FROM videos AS existing WHERE existing.file_path = source.file_path
);

UPDATE videos AS video
SET camera_id = (
        SELECT camera.id FROM cameras AS camera
        WHERE camera.name = source.camera_name ORDER BY camera.id LIMIT 1
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
