const pool = require('../db/db');

// Tally groups mirror the Excel's monthly COUNTIF section.
// 体調他 (taicho_ta) and 支援他 (shien_ta) are free text and intentionally excluded.
const TALLY_GROUPS = {
  食事: ['kanshoku', 'hanbun', 'nokoshi'],
  体調: ['shokuyoku_teika', 'kaoiro_genki', 'furatsuki'],
  支援: ['koekake', 'shinbun_yubin', 'genkan_anzen'],
  連絡: ['ihen_fuzai', 'renraku_you'],
};

function isChecked(fieldValue) {
  if (fieldValue == null) return false;
  const v = typeof fieldValue === 'object' ? fieldValue.value : fieldValue;
  return v === true || v === '✓' || v === 'true';
}

// GET /api/status-report?patient_id=&year_month=YYYY-MM
const getPatientReport = async (req, res) => {
  try {
    const { patient_id, year_month } = req.query;
    if (!patient_id || !year_month)
      return res.status(400).json({ error: "patient_id and year_month are required" });

    const patientResult = await pool.query(
      `SELECT id, name FROM patients WHERE id=$1`,
      [patient_id]
    );
    if (patientResult.rows.length === 0)
      return res.status(404).json({ error: "patient not found" });

    const [y, m] = year_month.split('-').map(Number);
    const from = `${year_month}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const to = `${year_month}-${String(lastDay).padStart(2, '0')}`;

    const dailyResult = await pool.query(
      `SELECT record_date, values FROM status_records
       WHERE screen_key='daily_status' AND patient_id=$1 AND record_date BETWEEN $2 AND $3
       ORDER BY record_date`,
      [patient_id, from, to]
    );

    const tallies = {};
    for (const [group, keys] of Object.entries(TALLY_GROUPS)) {
      tallies[group] = {};
      for (const key of keys) {
        tallies[group][key] = 0;
      }
    }
    for (const row of dailyResult.rows) {
      const values = row.values || {};
      for (const keys of Object.values(TALLY_GROUPS)) {
        for (const key of keys) {
          if (isChecked(values[key])) {
            for (const group of Object.keys(TALLY_GROUPS)) {
              if (TALLY_GROUPS[group].includes(key)) tallies[group][key] += 1;
            }
          }
        }
      }
    }

    const monthlyResult = await pool.query(
      `SELECT values FROM status_records
       WHERE screen_key='monthly_report' AND patient_id=$1 AND record_year_month=$2`,
      [patient_id, year_month]
    );

    res.json({
      patient: patientResult.rows[0],
      yearMonth: year_month,
      days: dailyResult.rows,
      tallies,
      monthlyReport: monthlyResult.rows[0]?.values || null,
    });
  } catch (e) {
    console.error("getPatientReport error:", e);
    res.status(500).json({ error: "internal" });
  }
};

module.exports = { getPatientReport };
