const WINDOW_MS = Number(process.env.AUTH_RATE_WINDOW_MS || 10 * 60 * 1000); // 10m
const MAX_REQ_PER_IP = Number(process.env.AUTH_MAX_REQ_PER_IP || 50);
const MAX_FAILED_PER_ACCOUNT = Number(process.env.AUTH_MAX_FAILED_PER_ACCOUNT || 5);
const LOCK_MS = Number(process.env.AUTH_LOCK_MS || 15 * 60 * 1000); // 15m

const ipWindow = new Map();
const accountFailures = new Map();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function now() {
  return Date.now();
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || "unknown";
}

function normalizeLoginId(raw) {
  if (raw == null) return "";
  return String(raw).trim().toLowerCase();
}

function throttleByIp(req, res, next) {
  const ip = getClientIp(req);
  const ts = now();
  const entry = ipWindow.get(ip);

  if (!entry || ts > entry.resetAt) {
    ipWindow.set(ip, { count: 1, resetAt: ts + WINDOW_MS });
    return next();
  }

  entry.count += 1;
  if (entry.count > MAX_REQ_PER_IP) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetAt - ts) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "Too many login attempts. Please try again later.",
    });
  }
  return next();
}

function authBruteForceGuard(req, res, next) {
  const loginId = normalizeLoginId(req.body?.username);
  if (!loginId) return next();

  const key = `${getClientIp(req)}::${loginId}`;
  const entry = accountFailures.get(key);
  if (!entry) return next();

  const ts = now();
  if (entry.lockUntil && ts < entry.lockUntil) {
    const retryAfter = Math.max(1, Math.ceil((entry.lockUntil - ts) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      error: "Account temporarily locked due to repeated failed attempts.",
    });
  }

  // Lock expired; keep fail count but clear lock.
  if (entry.lockUntil && ts >= entry.lockUntil) {
    entry.lockUntil = 0;
  }
  return next();
}

function recordAuthFailure(req) {
  const loginId = normalizeLoginId(req.body?.username);
  if (!loginId) return;

  const key = `${getClientIp(req)}::${loginId}`;
  const ts = now();
  const entry = accountFailures.get(key) || { fails: 0, lockUntil: 0, lastFailAt: 0 };
  entry.fails += 1;
  entry.lastFailAt = ts;
  if (entry.fails >= MAX_FAILED_PER_ACCOUNT) {
    entry.lockUntil = ts + LOCK_MS;
  }
  accountFailures.set(key, entry);
}

function clearAuthFailures(req) {
  const loginId = normalizeLoginId(req.body?.username);
  if (!loginId) return;
  const key = `${getClientIp(req)}::${loginId}`;
  accountFailures.delete(key);
}

setInterval(() => {
  const ts = now();
  for (const [ip, entry] of ipWindow.entries()) {
    if (ts > entry.resetAt) ipWindow.delete(ip);
  }
  for (const [key, entry] of accountFailures.entries()) {
    const stale =
      ts - (entry.lastFailAt || 0) > Math.max(WINDOW_MS, LOCK_MS) &&
      (!entry.lockUntil || ts > entry.lockUntil);
    if (stale) accountFailures.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref();

module.exports = {
  throttleByIp,
  authBruteForceGuard,
  recordAuthFailure,
  clearAuthFailures,
};
