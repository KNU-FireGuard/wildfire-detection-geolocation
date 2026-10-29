const pool = require('../config/db');

async function saveLiveCameras(items) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const saved = [];
    for (const item of items) {
      const { rows } = await client.query(`
        INSERT INTO cameras (name, source_type, latitude, longitude, provider_key)
        VALUES ($1, 'live', $2, $3, $4)
        ON CONFLICT (provider_key) DO UPDATE SET
          name = EXCLUDED.name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude
        RETURNING id
      `, [item.name, item.latitude, item.longitude, item.providerKey]);
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
