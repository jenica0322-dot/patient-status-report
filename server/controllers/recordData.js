const pool = require('../db/db');

// POST /api/status-records
// body: { screen_key, patient_id, record_date? ('YYYY-MM-DD'), record_year_month? ('YYYY-MM'), values }
// Exactly one of record_date / record_year_month must be provided.
// Upserts: saving the same patient+day (or patient+month) again replaces the row instead of duplicating.
const recordData = async (req, res) => {
  try {
    const { screen_key, patient_id, record_date, record_year_month, values } = req.body || {};

    if (!screen_key || !patient_id || !values)
      return res.status(400).json({ error: "screen_key, patient_id and values are required" });

    if (!record_date && !record_year_month)
      return res.status(400).json({ error: "record_date or record_year_month is required" });

    let result;
    if (record_date) {
      result = await pool.query(
        `INSERT INTO status_records (screen_key, patient_id, record_date, values)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (screen_key, patient_id, record_date) WHERE record_date IS NOT NULL
         DO UPDATE SET values = EXCLUDED.values, updated_at = now()
         RETURNING id`,
        [screen_key, patient_id, record_date, JSON.stringify(values)]
      );
    } else {
      result = await pool.query(
        `INSERT INTO status_records (screen_key, patient_id, record_year_month, values)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (screen_key, patient_id, record_year_month) WHERE record_year_month IS NOT NULL
         DO UPDATE SET values = EXCLUDED.values, updated_at = now()
         RETURNING id`,
        [screen_key, patient_id, record_year_month, JSON.stringify(values)]
      );
    }

    res.json({ ok: true, record_id: result.rows[0].id });
  } catch (e) {
    console.error("recordData error:", e);
    res.status(500).json({ error: "internal" });
  }
};

// GET /api/status-records?screen_key=&patient_id=&from=&to=&record_year_month=
const getStatusRecords = async (req, res) => {
  try {
    const { screen_key, patient_id, from, to, record_year_month } = req.query;

    const conditions = [];
    const params = [];

    if (screen_key) {
      params.push(screen_key);
      conditions.push(`screen_key = $${params.length}`);
    }
    if (patient_id) {
      params.push(patient_id);
      conditions.push(`patient_id = $${params.length}`);
    }
    if (record_year_month) {
      params.push(record_year_month);
      conditions.push(`record_year_month = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`record_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`record_date <= $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT id, screen_key, patient_id, record_date, record_year_month, values, created_at, updated_at
       FROM status_records
       ${where}
       ORDER BY record_date NULLS LAST, record_year_month NULLS LAST, created_at DESC`,
      params
    );

    res.json(result.rows);
  } catch (e) {
    console.error('getStatusRecords error:', e);
    res.status(500).json({ error: "internal" });
  }
};

module.exports = { recordData, getStatusRecords };
