// server/lib/devHttps.js
// Self-signed HTTPS cert for the local dev server, so it can be opened from a
// phone on the same Wi-Fi (getUserMedia — camera/mic for QR + voice input —
// requires a secure context, which plain http:// over a LAN IP is not).
//
// The cert's SAN list is tied to the machine's current LAN IPs, so it's
// regenerated automatically whenever those change (e.g. switching networks)
// instead of silently going stale.
const fs = require("fs");
const os = require("os");
const path = require("path");
const selfsigned = require("selfsigned");

const CERT_DIR = path.join(__dirname, "..", "certs");
const KEY_PATH = path.join(CERT_DIR, "dev-key.pem");
const CERT_PATH = path.join(CERT_DIR, "dev-cert.pem");
const META_PATH = path.join(CERT_DIR, "dev-cert.meta.json");

function getLocalNetworkIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function loadExisting(expectedIPs) {
  if (!fs.existsSync(KEY_PATH) || !fs.existsSync(CERT_PATH) || !fs.existsSync(META_PATH)) {
    return null;
  }
  try {
    const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
    const sameIPs =
      Array.isArray(meta.ips) &&
      meta.ips.length === expectedIPs.length &&
      meta.ips.every((ip) => expectedIPs.includes(ip));
    if (!sameIPs || !meta.expiresAt || Date.now() >= meta.expiresAt) return null;
    return {
      key: fs.readFileSync(KEY_PATH, "utf8"),
      cert: fs.readFileSync(CERT_PATH, "utf8"),
    };
  } catch {
    return null;
  }
}

async function generate(ips) {
  const altNames = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    { type: 7, ip: "::1" },
    ...ips.map((ip) => ({ type: 7, ip })),
  ];

  const days = 365;
  // selfsigned@5's generate() is async (it shells out to WebCrypto for keygen).
  const pems = await selfsigned.generate([{ name: "commonName", value: "localhost" }], {
    days,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames },
    ],
  });

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(KEY_PATH, pems.private);
  fs.writeFileSync(CERT_PATH, pems.cert);
  fs.writeFileSync(
    META_PATH,
    JSON.stringify({ ips, expiresAt: Date.now() + days * 24 * 60 * 60 * 1000 - 60 * 60 * 1000 })
  );

  return { key: pems.private, cert: pems.cert };
}

// Returns { key, cert } PEM strings, reusing a cached cert when it's still
// valid for the machine's current LAN IPs, generating a fresh one otherwise.
async function ensureDevCert() {
  const ips = getLocalNetworkIPs();
  return loadExisting(ips) || generate(ips);
}

module.exports = { ensureDevCert, getLocalNetworkIPs };
