require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../server/db/db');

async function run() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);

  const dir = __dirname;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`- skip (already applied): ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`- applying: ${file}`);
    await pool.tx(async (conn) => {
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    });
  }

  console.log('Migrations complete.');
  await pool.end();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
