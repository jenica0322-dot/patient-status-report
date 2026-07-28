const { getPool } = require("../db/registry");

const primary = () => getPool("primary");

function patientsSource() {
  const explicit = (process.env.PATIENTS_DB_SOURCE || "").trim().toLowerCase();
  if (explicit) return explicit;
  return process.env.DB_USERS_HOST ? "users" : "primary";
}

/** Resolve patient display info. patient_id === mst_customer.pat_id when source is users. */
async function resolvePatient(patientId) {
  if (patientsSource() === "users") {
    const result = await getPool("users").query(
      `SELECT
         c.pat_id,
         c.customer_name,
         c.belong_area,
         a.belong_area_name
       FROM public.mst_customer c
       LEFT JOIN public.mst_belong_area a ON a.belong_area = c.belong_area
       WHERE c.pat_id::bigint = $1::bigint
       LIMIT 1`,
      [patientId]
    );
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      id: Number(r.pat_id),
      name: r.customer_name || "",
      belong_area: r.belong_area,
      belong_area_name: r.belong_area_name,
    };
  }

  const result = await primary().query(
    `SELECT id, name FROM patients WHERE id=$1`,
    [patientId]
  );
  return result.rows[0] || null;
}

// Tally groups mirror the Excel's monthly COUNTIF section.
const TALLY_GROUPS = {
  食事: ["kanshoku", "hanbun", "nokoshi"],
  体調: ["shokuyoku_teika", "kaoiro_genki", "furatsuki"],
  支援: ["koekake", "shinbun_yubin", "genkan_anzen"],
  連絡: ["ihen_fuzai", "renraku_you"],
};

function isChecked(fieldValue) {
  if (fieldValue == null) return false;
  const v = typeof fieldValue === "object" ? fieldValue.value : fieldValue;
  return v === true || v === "✓" || v === "true";
}

// Shared by the JSON report endpoint and the Excel export — one query path, one shape.
// Empty status_records is OK → days=[] / monthlyReport=null, not an error.
async function loadReportData(patientId, yearMonth) {
  let patient = null;
  try {
    patient = await resolvePatient(patientId);
  } catch (lookupErr) {
    console.error("resolvePatient error:", lookupErr);
    // Still serve an empty report shell; do not fail solely on lookup.
  }
  if (!patient) {
    patient = {
      id: Number(patientId),
      name: `pat_id ${patientId}`,
    };
  }

  const [y, m] = yearMonth.split("-").map(Number);
  const from = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

  const dailyResult = await primary().query(
    `SELECT record_date, values FROM status_records
     WHERE screen_key='daily_status' AND patient_id=$1 AND record_date BETWEEN $2 AND $3
     ORDER BY record_date`,
    [patientId, from, to]
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

  const monthlyResult = await primary().query(
    `SELECT values FROM status_records
     WHERE screen_key='monthly_report' AND patient_id=$1 AND record_year_month=$2`,
    [patientId, yearMonth]
  );

  return {
    patient,
    yearMonth,
    daysInMonth: lastDay,
    days: dailyResult.rows,
    tallies,
    monthlyReport: monthlyResult.rows[0]?.values || null,
  };
}

// GET /api/status-report?patient_id=&year_month=YYYY-MM
// patient_id is mst_customer.pat_id when PATIENTS_DB_SOURCE=users
const getPatientReport = async (req, res) => {
  try {
    const { patient_id, year_month } = req.query;
    if (!patient_id || !year_month)
      return res.status(400).json({ error: "patient_id and year_month are required" });

    const data = await loadReportData(patient_id, year_month);
    res.json(data);
  } catch (e) {
    console.error("getPatientReport error:", e);
    res.status(500).json({ error: "internal", detail: e.message });
  }
};

// GET /api/status-report/export?patient_id=&year_month=YYYY-MM
// Streams an .xlsx built to match the 状況記録表兼報告書 layout, ready to print.
const exportPatientReportExcel = async (req, res) => {
  try {
    const { patient_id, year_month } = req.query;
    if (!patient_id || !year_month)
      return res.status(400).json({ error: "patient_id and year_month are required" });

    const [data, dailyFieldsResult, monthlyFieldsResult] = await Promise.all([
      loadReportData(patient_id, year_month),
      primary().query(
        `SELECT field_key, field_label, field_type, phrases, order_index FROM status_fields
         WHERE screen_key='daily_status' ORDER BY order_index, field_key`
      ),
      primary().query(
        `SELECT field_key, field_label, field_type, phrases, order_index FROM status_fields
         WHERE screen_key='monthly_report' ORDER BY order_index, field_key`
      ),
    ]);

    const parsePhrases = (p) => {
      try {
        return typeof p === "string" ? JSON.parse(p || "[]") : Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    };
    const dailyFields = dailyFieldsResult.rows.map((r) => ({ ...r, phrases: parsePhrases(r.phrases) }));
    const monthlyFields = monthlyFieldsResult.rows.map((r) => ({ ...r, phrases: parsePhrases(r.phrases) }));

    const { buildReportWorkbook } = require("../lib/xlsxReportBuilder");
    const workbook = await buildReportWorkbook({ data, dailyFields, monthlyFields });

    const fileName = `状況記録表兼報告書_${data.patient.name}_${year_month}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error("exportPatientReportExcel error:", e);
    res.status(500).json({ error: "internal", detail: e.message });
  }
};

module.exports = { getPatientReport, exportPatientReportExcel };
