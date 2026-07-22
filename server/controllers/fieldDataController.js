const pool = require("../db/db");

// GET /api/status-fields?screen_key=daily_status
const getStatusFields = async (req, res) => {
  try {
    const screenKey = req.query.screen_key || req.params.screenKey || null;
    let result;

    if (screenKey) {
      result = await pool.query(
        `SELECT field_key, field_label, field_type, phrases, order_index, screen_key
         FROM status_fields
         WHERE screen_key=$1
         ORDER BY order_index, field_key`,
        [screenKey]
      );
    } else {
      result = await pool.query(
        `SELECT field_key, field_label, field_type, phrases, order_index, screen_key
         FROM status_fields
         ORDER BY screen_key, order_index, field_key`
      );
    }

    const fields = result.rows.map(row => {
      let phrases = [];
      try {
        if (typeof row.phrases === 'string') {
          phrases = JSON.parse(row.phrases || '[]');
        } else if (Array.isArray(row.phrases)) {
          phrases = row.phrases;
        }
      } catch (e) {
        console.warn('Invalid phrases JSON for field', row.field_key, ':', row.phrases);
      }
      return { ...row, phrases };
    });

    res.json(fields);
  } catch (e) {
    console.error("getStatusFields error:", e);
    res.status(500).json({ error: "internal" });
  }
};

// POST /api/status-fields  (create or update a field)
const saveStatusField = async (req, res) => {
  try {
    const {
      screen_key,
      field_key,
      field_label,
      field_type,
      phrases = [],
      order_index = 0,
    } = req.body;

    if (!screen_key || !field_key)
      return res.status(400).json({ error: "screen_key and field_key required" });

    await pool.query(
      `INSERT INTO status_fields (screen_key, field_key, field_label, field_type, phrases, order_index)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (screen_key, field_key)
       DO UPDATE SET
         field_label = EXCLUDED.field_label,
         field_type = EXCLUDED.field_type,
         phrases = EXCLUDED.phrases,
         order_index = EXCLUDED.order_index`,
      [screen_key, field_key, field_label, field_type, JSON.stringify(phrases), order_index]
    );

    res.json({ ok: true, message: "Field saved successfully" });
  } catch (e) {
    console.error("saveStatusField error:", e);
    res.status(500).json({ error: "internal" });
  }
};

// DELETE /api/status-fields/:screenKey/:fieldKey
const deleteStatusField = async (req, res) => {
  try {
    const { screenKey, fieldKey } = req.params;

    if (!screenKey || !fieldKey)
      return res.status(400).json({ error: "missing parameters" });

    await pool.query(
      `DELETE FROM status_fields WHERE screen_key=$1 AND field_key=$2`,
      [screenKey, fieldKey]
    );

    res.json({ ok: true, message: "Field deleted successfully" });
  } catch (e) {
    console.error("deleteStatusField error:", e);
    res.status(500).json({ error: "internal" });
  }
};

module.exports = {
  getStatusFields,
  saveStatusField,
  deleteStatusField,
};
