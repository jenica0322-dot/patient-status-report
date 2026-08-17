const pool = require('../db/db');

// Finds the status_records row for this patient+day (or patient+month), creating
// an empty one if it doesn't exist yet — photos can be attached before the user
// has typed/saved any field values. Uses the same upsert as recordData.js but
// never touches `values`, so it can't clobber data already saved via 保存.
async function findOrCreateRecordId({ screen_key, patient_id, record_date, record_year_month }) {
  if (record_date) {
    const result = await pool.query(
      `INSERT INTO status_records (screen_key, patient_id, record_date, values)
       VALUES ($1,$2,$3,'{}'::jsonb)
       ON CONFLICT (screen_key, patient_id, record_date) WHERE record_date IS NOT NULL
       DO UPDATE SET updated_at = now()
       RETURNING id`,
      [screen_key, patient_id, record_date]
    );
    return result.rows[0].id;
  }
  const result = await pool.query(
    `INSERT INTO status_records (screen_key, patient_id, record_year_month, values)
     VALUES ($1,$2,$3,'{}'::jsonb)
     ON CONFLICT (screen_key, patient_id, record_year_month) WHERE record_year_month IS NOT NULL
     DO UPDATE SET updated_at = now()
     RETURNING id`,
    [screen_key, patient_id, record_year_month]
  );
  return result.rows[0].id;
}

function toPhotoDto(row) {
  return {
    id: row.id,
    url: `/api/photos/${row.id}`,
    original_filename: row.original_filename,
    created_at: row.created_at,
    record_date: row.record_date ?? undefined,
    record_year_month: row.record_year_month ?? undefined,
  };
}

// POST /api/status-records/photos (multipart/form-data)
// fields: screen_key, patient_id, record_date? ('YYYY-MM-DD'), record_year_month? ('YYYY-MM')
// files: photos[] (image/*)
const uploadPhotos = async (req, res) => {
  try {
    const { screen_key, patient_id, record_date, record_year_month } = req.body || {};
    const files = req.files || [];

    if (!screen_key || !patient_id)
      return res.status(400).json({ error: "screen_key and patient_id are required" });
    if (!record_date && !record_year_month)
      return res.status(400).json({ error: "record_date or record_year_month is required" });
    if (files.length === 0)
      return res.status(400).json({ error: "no photos uploaded" });

    const recordId = await findOrCreateRecordId({ screen_key, patient_id, record_date, record_year_month });

    const photos = [];
    for (const file of files) {
      const result = await pool.query(
        `INSERT INTO status_record_photos
           (status_record_id, patient_id, mime_type, original_filename, file_size, file_data)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, original_filename, created_at`,
        [recordId, patient_id, file.mimetype, file.originalname, file.size, file.buffer]
      );
      photos.push(toPhotoDto(result.rows[0]));
    }

    res.json({ record_id: recordId, photos });
  } catch (e) {
    console.error("uploadPhotos error:", e);
    res.status(500).json({ error: "internal", detail: e.message });
  }
};

// GET /api/status-records/photos?screen_key=&patient_id=&record_date=|record_year_month=
// Photos already attached to one specific record (daily or monthly).
const getRecordPhotos = async (req, res) => {
  try {
    const { screen_key, patient_id, record_date, record_year_month } = req.query;
    if (!screen_key || !patient_id || (!record_date && !record_year_month))
      return res
        .status(400)
        .json({ error: "screen_key, patient_id and record_date or record_year_month are required" });

    const column = record_date ? "record_date" : "record_year_month";
    const value = record_date || record_year_month;

    const result = await pool.query(
      `SELECT p.id, p.original_filename, p.created_at
       FROM status_record_photos p
       JOIN status_records r ON r.id = p.status_record_id
       WHERE r.screen_key = $1 AND r.patient_id = $2 AND r.${column} = $3
       ORDER BY p.created_at`,
      [screen_key, patient_id, value]
    );

    res.json(result.rows.map(toPhotoDto));
  } catch (e) {
    console.error("getRecordPhotos error:", e);
    res.status(500).json({ error: "internal", detail: e.message });
  }
};

// GET /api/status-report/photos?patient_id=&year_month=YYYY-MM
// Every photo across the whole report — every day of the month plus the
// monthly_report row — labeled with which record it came from.
const getReportPhotos = async (req, res) => {
  try {
    const { patient_id, year_month } = req.query;
    if (!patient_id || !year_month)
      return res.status(400).json({ error: "patient_id and year_month are required" });

    const [y, m] = year_month.split("-").map(Number);
    const from = `${year_month}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const to = `${year_month}-${String(lastDay).padStart(2, "0")}`;

    const result = await pool.query(
      `SELECT p.id, p.original_filename, p.created_at, r.record_date, r.record_year_month
       FROM status_record_photos p
       JOIN status_records r ON r.id = p.status_record_id
       WHERE p.patient_id = $1
         AND (r.record_date BETWEEN $2 AND $3 OR r.record_year_month = $4)
       ORDER BY r.record_date NULLS LAST, p.created_at`,
      [patient_id, from, to, year_month]
    );

    res.json(result.rows.map(toPhotoDto));
  } catch (e) {
    console.error("getReportPhotos error:", e);
    res.status(500).json({ error: "internal", detail: e.message });
  }
};

// GET /api/photos/:id — streams the raw image bytes.
const getPhotoFile = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT mime_type, file_data FROM status_record_photos WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).end();

    res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(row.file_data);
  } catch (e) {
    console.error("getPhotoFile error:", e);
    res.status(500).json({ error: "internal" });
  }
};

// DELETE /api/photos/:id
const deletePhoto = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM status_record_photos WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("deletePhoto error:", e);
    res.status(500).json({ error: "internal" });
  }
};

module.exports = { uploadPhotos, getRecordPhotos, getReportPhotos, getPhotoFile, deletePhoto };
