const pool = require("../db/db");

// GET /api/patients
const getPatients = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, created_at FROM patients ORDER BY name`
    );
    res.json(result.rows);
  } catch (e) {
    console.error("getPatients error:", e);
    res.status(500).json({ error: "internal" });
  }
};

// POST /api/patients  (create, or update when id is provided)
const savePatient = async (req, res) => {
  try {
    const { id, name } = req.body;

    if (!name || !name.trim())
      return res.status(400).json({ error: "name is required" });

    let result;
    if (id) {
      result = await pool.query(
        `UPDATE patients SET name=$1 WHERE id=$2 RETURNING id, name, created_at`,
        [name.trim(), id]
      );
      if (result.rows.length === 0)
        return res.status(404).json({ error: "patient not found" });
    } else {
      result = await pool.query(
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

// DELETE /api/patients/:id
const deletePatient = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "missing id" });

    await pool.query(`DELETE FROM patients WHERE id=$1`, [id]);
    res.json({ ok: true, message: "Patient deleted successfully" });
  } catch (e) {
    console.error("deletePatient error:", e);
    res.status(500).json({ error: "internal" });
  }
};

module.exports = { getPatients, savePatient, deletePatient };
