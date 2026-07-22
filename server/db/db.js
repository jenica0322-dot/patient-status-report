require("dotenv").config();
const { Pool, types } = require("pg");

// DATE (oid 1082) defaults to a JS Date at local midnight, which shifts to the
// wrong calendar day once serialized to JSON in timezones ahead of UTC. Keep
// it as the raw 'YYYY-MM-DD' string instead.
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

pool.tx = async (cb) => {
    const connection = await pool.connect();
    let res;
    try {
        await connection.query('BEGIN');
        try{
            res = await cb(connection);
            await connection.query('COMMIT');
        } catch(err) {
            await connection.query('ROLLBACK');
            throw err;
        }
    } catch(err) {
        throw err;
    } finally {
        connection.release();
    }
    return res;
}

module.exports = pool;
