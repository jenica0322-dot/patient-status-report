require("dotenv").config();
const { Pool, types } = require("pg");

// DATE (oid 1082) → keep as 'YYYY-MM-DD' string (avoid TZ day-shift on JSON).
types.setTypeParser(1082, (val) => val);

/** @type {Map<string, import('pg').Pool>} */
const pools = new Map();

function attachTx(pool) {
  pool.tx = async (cb) => {
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      try {
        const res = await cb(connection);
        await connection.query("COMMIT");
        return res;
      } catch (err) {
        await connection.query("ROLLBACK");
        throw err;
      }
    } finally {
      connection.release();
    }
  };
  return pool;
}

function readPrimaryConfig() {
  const host = process.env.DB_HOST;
  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const port = process.env.DB_PORT;
  if (!host || !database || !user) {
    throw new Error(
      "Primary DB env incomplete: need DB_HOST, DB_NAME, DB_USER (and usually DB_PASSWORD, DB_PORT)"
    );
  }
  return { host, database, user, password, port: port ? Number(port) : undefined };
}

/**
 * Discover named sources from DB_<NAME>_HOST / _PORT / _USER / _PASSWORD / _NAME.
 * Example: DB_USERS_HOST → source name "users".
 */
function discoverNamedConfigs() {
  /** @type {Record<string, { host: string, database?: string, user?: string, password?: string, port?: number }>} */
  const out = {};
  const hostRe = /^DB_([A-Z][A-Z0-9]*)_HOST$/;

  for (const key of Object.keys(process.env)) {
    const m = key.match(hostRe);
    if (!m) continue;
    const name = m[1].toLowerCase();
    const prefix = `DB_${m[1]}_`;
    const host = process.env[`${prefix}HOST`];
    if (!host) continue;
    out[name] = {
      host,
      database: process.env[`${prefix}NAME`],
      user: process.env[`${prefix}USER`],
      password: process.env[`${prefix}PASSWORD`],
      port: process.env[`${prefix}PORT`]
        ? Number(process.env[`${prefix}PORT`])
        : undefined,
    };
  }
  return out;
}

function createPool(label, config) {
  if (!config.database || !config.user) {
    throw new Error(
      `DB source "${label}" incomplete: need host, name/database, and user env vars`
    );
  }
  const pool = new Pool({
    host: config.host,
    database: config.database,
    user: config.user,
    password: config.password,
    port: config.port,
  });
  return attachTx(pool);
}

function ensurePool(name) {
  const key = name.toLowerCase();
  if (pools.has(key)) return pools.get(key);

  let config;
  if (key === "primary") {
    config = readPrimaryConfig();
  } else {
    const named = discoverNamedConfigs();
    config = named[key];
    if (!config) {
      throw new Error(
        `Unknown DB source "${name}". Set DB_${name.toUpperCase()}_HOST (and _NAME, _USER, …)`
      );
    }
  }

  const pool = createPool(key, config);
  pools.set(key, pool);
  return pool;
}

/**
 * @param {string} [name="primary"]
 * @returns {import('pg').Pool}
 */
function getPool(name = "primary") {
  return ensurePool(name);
}

/** List configured source names (primary + any DB_*_HOST). */
function listSources() {
  return ["primary", ...Object.keys(discoverNamedConfigs())];
}

async function endAll() {
  const closing = [...pools.values()].map((p) => p.end().catch(() => {}));
  pools.clear();
  await Promise.all(closing);
}

module.exports = { getPool, listSources, endAll };
