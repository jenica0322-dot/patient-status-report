/**
 * Backward-compatible primary pool.
 * Prefer: const { getPool } = require("./registry"); getPool("users")
 */
const { getPool, listSources, endAll } = require("./registry");

const primary = getPool("primary");

module.exports = primary;
module.exports.getPool = getPool;
module.exports.listSources = listSources;
module.exports.endAll = endAll;
