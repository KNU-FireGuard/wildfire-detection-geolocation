-- 개발용 CCTV와 녹화 영상 메타데이터. 실제 영상 파일은 Git에 포함하지 않습니다.
-- 프로젝트 루트에서 실행합니다. 각 file_path에 해당하는 파일을 data/videos/에 준비하세요.
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

-- 이전 시드의 영상 경로를 실제 파일명으로 옮김 (행 ID 유지, 새 경로 행이 이미 있으면 건너뜀)
UPDATE videos AS video
SET file_path = source.new_path,
    original_filename = source.new_filename
FROM (VALUES
    ('data/videos/경북의성.mp4', 'data/videos/경북_의성_안평면_마전리_국토교통부_CCTV_사용자녹화편집전송_sub_HQ_20250322V23087.mp4', '경북_의성_안평면_마전리_국토교통부_CCTV_사용자녹화편집전송_sub_HQ_20250322V23087.mp4'),
    ('data/videos/단촌4터널.mp4', 'data/videos/단촌4터널(청주외부1).mp4', '단촌4터널(청주외부1).mp4')
) AS source(old_path, new_path, new_filename)
WHERE video.file_path = source.old_path
  AND NOT EXISTS (SELECT 1 FROM videos AS existing WHERE existing.file_path = source.new_path);

INSERT INTO videos (camera_id, original_filename, file_path)
SELECT
    (SELECT camera.id FROM cameras AS camera
     WHERE camera.name = source.camera_name AND camera.source_type = 'test'
     ORDER BY camera.id LIMIT 1),
    source.original_filename,
    source.file_path
FROM (VALUES
    ('경북의성', '경북_의성_안평면_마전리_국토교통부_CCTV_사용자녹화편집전송_sub_HQ_20250322V23087.mp4', 'data/videos/경북_의성_안평면_마전리_국토교통부_CCTV_사용자녹화편집전송_sub_HQ_20250322V23087.mp4'),
    ('청성', '청성.mp4', 'data/videos/청성.mp4'),
    ('기도4교', '기도4교.mp4', 'data/videos/기도4교.mp4'),
    ('단촌4터널', '단촌4터널(청주외부1).mp4', 'data/videos/단촌4터널(청주외부1).mp4')
) AS source(camera_name, original_filename, file_path)
WHERE NOT EXISTS (
    SELECT 1 FROM videos AS existing WHERE existing.file_path = source.file_path
);

UPDATE videos AS video
SET camera_id = (
        SELECT camera.id FROM cameras AS camera
        WHERE camera.name = source.camera_name AND camera.source_type = 'test'
        ORDER BY camera.id LIMIT 1
    ),
    original_filename = source.original_filename
FROM (VALUES
    ('경북의성', '경북_의성_안평면_마전리_국토교통부_CCTV_사용자녹화편집전송_sub_HQ_20250322V23087.mp4', 'data/videos/경북_의성_안평면_마전리_국토교통부_CCTV_사용자녹화편집전송_sub_HQ_20250322V23087.mp4'),
    ('청성', '청성.mp4', 'data/videos/청성.mp4'),
    ('기도4교', '기도4교.mp4', 'data/videos/기도4교.mp4'),
    ('단촌4터널', '단촌4터널(청주외부1).mp4', 'data/videos/단촌4터널(청주외부1).mp4')
) AS source(camera_name, original_filename, file_path)
WHERE video.file_path = source.file_path;

COMMIT;
