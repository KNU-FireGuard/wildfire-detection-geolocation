const defaultPool = require('../config/db');

// 옛 방식 키(좌표 포함)로 저장된 행을 이어받을 때 같은 CCTV로 보는 좌표 차이, 약 1km
const SAME_PLACE_DEGREES = 0.01;

// 갱신한 ITS 목록을 cameras에 반영합니다. 같은 CCTV는 새 행을 만들지 않고 기존 행을 재사용합니다.
// 1) 식별 키가 같은 행, 2) 키가 달라졌어도 이름이 같고 좌표가 약 1km 안인 실시간 행을 찾아 키와 좌표를 갱신
// 3) 없으면 새 행을 추가합니다. Test 카메라는 대상이 아닙니다.
async function saveLiveCameras(items, { pool = defaultPool } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = [];
    for (const item of items) {
      const params = [item.name, item.latitude, item.longitude, item.providerKey, SAME_PLACE_DEGREES];
      let { rows } = await client.query(`
        UPDATE cameras SET name = $1, latitude = $2, longitude = $3, provider_key = $4
        WHERE id = (
          SELECT id FROM cameras
          WHERE source_type = 'live'
            AND (provider_key = $4
              OR (name = $1 AND ABS(latitude - $2::double precision) < $5 AND ABS(longitude - $3::double precision) < $5))
          ORDER BY (provider_key = $4) DESC, id ASC
          LIMIT 1
        )
        RETURNING id
      `, params);
      if (rows.length === 0) {
        ({ rows } = await client.query(`
          INSERT INTO cameras (name, source_type, latitude, longitude, provider_key)
          VALUES ($1, 'live', $2, $3, $4)
          ON CONFLICT (provider_key) DO UPDATE SET
            name = EXCLUDED.name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
          RETURNING id
        `, params.slice(0, 4)));
      }
      saved.push({ ...item, cameraId: rows[0].id });
    }
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

module.exports = { saveLiveCameras };
