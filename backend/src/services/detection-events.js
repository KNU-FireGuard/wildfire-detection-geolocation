const pool = require('../config/db');

async function finalizeRunEvents(run) {
  const eventIds = [...run.eventIdsByClass.values()];
  if (eventIds.length === 0) return;

  await pool.query(`
    UPDATE detection_events
    SET ended_at = GREATEST(started_at, updated_at),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ANY($1::INTEGER[]) AND ended_at IS NULL
  `, [eventIds]);
}

module.exports = { finalizeRunEvents };
