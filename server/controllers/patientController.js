const { getPool } = require("../db/registry");

const primary = () => getPool("primary");

/**
 * Where patient list is read from.
 * - primary: local `patients` table
 * - users: external DB_USERS_* → mst_customer (+ mst_belong_area)  [read-only]
 * Default: "users" when DB_USERS_HOST is set, otherwise "primary".
 */
function patientsSource() {
  const explicit = (process.env.PATIENTS_DB_SOURCE || "").trim().toLowerCase();
  if (explicit) return explicit;
  return process.env.DB_USERS_HOST ? "users" : "primary";
}

function parsePaging(query) {
  const page = Math.max(1, parseInt(String(query.page || "1"), 10) || 1);
  const limitRaw = parseInt(String(query.limit || "50"), 10) || 50;
  const limit = Math.min(100, Math.max(1, limitRaw));
  const offset = (page - 1) * limit;
  const q = String(query.q || "").trim();
  const belongArea = String(query.belong_area || "").trim();
  return { page, limit, offset, q, belongArea };
}

function mapCustomerRow(r) {
  return {
    id: Number(r.pat_id),
    name: r.customer_name || "",
    pat_id: r.pat_id,
    claim_pat_id: r.claim_pat_id,
    corporation_flag: r.corporation_flag,
    corporation_id: r.corporation_id,
    display_order_number: r.display_order_number,
    customer_name: r.customer_name,
    customer_kana: r.customer_kana,
    customer_sex: r.customer_sex,
    customer_birthday: r.customer_birthday,
    customer_zip_code1: r.customer_zip_code1,
    customer_zip_code2: r.customer_zip_code2,
    customer_tel: r.customer_tel,
    customer_address1: r.customer_address1,
    customer_address2: r.customer_address2,
    belong_area: r.belong_area,
    belong_area_name: r.belong_area_name,
    product_kind_code: r.product_kind_code,
  };
}

async function fetchPatientsFromUsers({ page, limit, offset, q, belongArea }) {
  const pool = getPool("users");
  const conditions = ["c.corporation_flag = 0"];
  const params = [];

  if (belongArea) {
    params.push(belongArea);
    conditions.push(`c.belong_area = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    conditions.push(`(
      COALESCE(c.customer_name, '') ILIKE $${i}
      OR COALESCE(c.customer_kana, '') ILIKE $${i}
      OR COALESCE(c.customer_tel, '') ILIKE $${i}
      OR COALESCE(c.customer_address1, '') ILIKE $${i}
      OR COALESCE(c.customer_address2, '') ILIKE $${i}
      OR CAST(c.pat_id AS TEXT) ILIKE $${i}
    )`);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM public.mst_customer c
     ${where}`,
    params
  );
  const total = countResult.rows[0]?.total ?? 0;

  const listParams = [...params, limit, offset];
  const result = await pool.query(
    `SELECT
       c.pat_id,
       c.claim_pat_id,
       c.corporation_flag,
       c.corporation_id,
       c.display_order_number,
       c.customer_name,
       c.customer_kana,
       c.customer_sex,
       c.customer_birthday,
       c.customer_zip_code1,
       c.customer_zip_code2,
       c.customer_tel,
       c.customer_address1,
       c.customer_address2,
       c.belong_area,
       a.belong_area_name,
       a.product_kind_code
     FROM public.mst_customer c
     LEFT JOIN public.mst_belong_area a
       ON a.belong_area = c.belong_area
     ${where}
     ORDER BY c.pat_id ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    listParams
  );

  const items = result.rows.map(mapCustomerRow);
  return {
    items,
    total,
    page,
    limit,
    hasMore: offset + items.length < total,
  };
}

async function fetchPatientsFromPrimary({ page, limit, offset, q }) {
  const conditions = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await primary().query(
    `SELECT COUNT(*)::int AS total FROM patients ${where}`,
    params
  );
  const total = countResult.rows[0]?.total ?? 0;

  const listParams = [...params, limit, offset];
  const result = await primary().query(
    `SELECT id, name, created_at FROM patients
     ${where}
     ORDER BY name
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    listParams
  );

  return {
    items: result.rows,
    total,
    page,
    limit,
    hasMore: offset + result.rows.length < total,
  };
}

async function fetchBelongAreas() {
  const pool = getPool("users");
  const result = await pool.query(
    `SELECT DISTINCT c.belong_area, a.belong_area_name
     FROM public.mst_customer c
     LEFT JOIN public.mst_belong_area a ON a.belong_area = c.belong_area
     WHERE c.corporation_flag = 0
       AND c.belong_area IS NOT NULL
       AND TRIM(c.belong_area) <> ''
     ORDER BY c.belong_area ASC`
  );
  return result.rows.map((r) => ({
    code: r.belong_area,
    name: r.belong_area_name || r.belong_area,
  }));
}

// GET /api/patients?page=&limit=&q=&belong_area=
const getPatients = async (req, res) => {
  try {
    const source = patientsSource();
    const paging = parsePaging(req.query);

    let payload;
    if (source === "users") {
      payload = await fetchPatientsFromUsers(paging);
    } else if (source === "primary") {
      payload = await fetchPatientsFromPrimary(paging);
    } else {
      return res.status(500).json({
        error: `Unknown PATIENTS_DB_SOURCE="${source}" (use primary|users)`,
      });
    }

    res.json(payload);
  } catch (e) {
    console.error("getPatients error:", e);
    res.status(500).json({ error: "internal", detail: e.message });
  }
};

// GET /api/patients/areas — lightweight filter options
const getPatientAreas = async (req, res) => {
  try {
    if (patientsSource() !== "users") {
      return res.json([]);
    }
    const areas = await fetchBelongAreas();
    res.json(areas);
  } catch (e) {
    console.error("getPatientAreas error:", e);
    res.status(500).json({ error: "internal", detail: e.message });
  }
};

// POST /api/patients — local only; external mst_customer is read-only
const savePatient = async (req, res) => {
  try {
    if (patientsSource() !== "primary") {
      return res.status(405).json({
        error: "patients are managed in mst_customer (external DB, read-only)",
      });
    }

    const { id, name } = req.body;

    if (!name || !name.trim())
      return res.status(400).json({ error: "name is required" });

    let result;
    if (id) {
      result = await primary().query(
        `UPDATE patients SET name=$1 WHERE id=$2 RETURNING id, name, created_at`,
        [name.trim(), id]
      );
      if (result.rows.length === 0)
        return res.status(404).json({ error: "patient not found" });
    } else {
      result = await primary().query(
        `INSERT INTO patients (name) VALUES ($1) RETURNING id, name, created_at`,
        [name.trim()]
      );
    }

    res.json({ ok: true, patient: result.rows[0] });
  } catch (e) {
    console.error("savePatient error:", e);
    res.status(500).json({ error: "internal" });
  }
};

// DELETE /api/patients/:id — local only
const deletePatient = async (req, res) => {
  try {
    if (patientsSource() !== "primary") {
      return res.status(405).json({
        error: "patients are managed in mst_customer (external DB, read-only)",
      });
    }

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "missing id" });

    await primary().query(`DELETE FROM patients WHERE id=$1`, [id]);
    res.json({ ok: true, message: "Patient deleted successfully" });
  } catch (e) {
    console.error("deletePatient error:", e);
    res.status(500).json({ error: "internal" });
  }
};

module.exports = { getPatients, getPatientAreas, savePatient, deletePatient };
