require('dotenv').config();
const pool = require('./db');

async function run() {
  await pool.query(
    `INSERT INTO mst_employee (employee_id, employee_password, employee_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (employee_id) DO NOTHING`,
    ['admin', 'pass', '管理者']
  );
  console.log('Seeded default login: admin / pass');
  await pool.end();
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
