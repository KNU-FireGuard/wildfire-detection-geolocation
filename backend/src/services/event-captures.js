function createCaptureStore({ pool }) {
  async function save(eventId, videoTimeMs, jpeg) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const event = await client.query('SELECT id FROM detection_events WHERE id = $1 FOR UPDATE', [eventId]);
      if (!event.rows.length) throw new Error('탐지 이벤트가 없습니다.');
      const last = await client.query(`SELECT video_time_ms FROM event_captures
        WHERE event_id = $1 ORDER BY video_time_ms DESC LIMIT 1`, [eventId]);
      if (last.rows.length && videoTimeMs - Number(last.rows[0].video_time_ms) < 5000) {
        await client.query('COMMIT');
        return null;
      }
      const { rows } = await client.query(`INSERT INTO event_captures (event_id, video_time_ms, jpeg)
        VALUES ($1, $2, $3) RETURNING id, event_id, video_time_ms, created_at`, [eventId, videoTimeMs, jpeg]);
      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  return { save };
}

module.exports = { createCaptureStore };
