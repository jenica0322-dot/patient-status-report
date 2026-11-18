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

    // 日次記録 keys are report columns / record keys and go into URLs (DELETE
    // /status-fields/:screenKey/:fieldKey): any characters, Japanese included,
    // except spaces and / ? # % \. A leading "__" is reserved for the built-in
    // 食べ残し / 体調 rows under daily_target.
    if (screen_key === "daily_status" || screen_key === "daily_target") {
      const ok =
        /^[^\s/?#%\\]+$/.test(field_key) &&
        (screen_key === "daily_target" || !field_key.startsWith("__"));
      if (!ok) return res.status(400).json({ error: "フィールドキーにスペースや / ? # % \\ は使えません" });
    }

    // A brand-new 日次記録 field is also registered as a Status Input category
    // (its daily_target heading row = the label shown above its input), so it
    // appears on the input screen and in マスター's list whichever client
    // saved it. Existing fields (e.g. うけとり's options being updated) are
    // left as they are.
    if (screen_key === "daily_status") {
      const exists = await pool.query(
        `SELECT 1 FROM status_fields WHERE screen_key='daily_status' AND field_key=$1`,
        [field_key]
      );
      if (!exists.rows.length) {
        await pool.query(
          `INSERT INTO status_fields (screen_key, field_key, field_label, field_type, phrases, order_index)
           VALUES ('daily_target', $1, $2, 'heading', '[]', $3)
           ON CONFLICT (screen_key, field_key) DO NOTHING`,
          [field_key, field_label, order_index]
        );
      }
    }

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
