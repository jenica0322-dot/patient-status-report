require("dotenv").config();
const https = require("https");
const express = require("express");
const next = require("next");
const bodyParser = require("body-parser");

const isDev = process.env.NODE_ENV !== "production";
const port = isDev ? 3099 : process.env.PORT || 3003;
const app = next({ dev: isDev });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const server = express();

  server.use(bodyParser.json());

  server.use('/api/auth', require('./routes/auth'));
  server.use('/api', require('./routes/dataRoutes'));

  console.log(`Running in ${isDev ? "development" : "production"} mode...`);

  server.all("*", (req, res) => {
    return handle(req, res);
  });

  // Dev runs over HTTPS (self-signed) rather than plain HTTP: getUserMedia
  // (camera for QR/photo capture, mic for voice input) only works in a secure
  // context, and a phone hitting the dev machine's LAN IP is never treated as
  // one over http://. Production keeps plain HTTP — TLS there is terminated
  // by whatever's in front of it.
  const { ensureDevCert, getLocalNetworkIPs } = isDev ? require("./lib/devHttps") : {};
  const httpServer = isDev
    ? https.createServer(await ensureDevCert(), server)
    : server;

  // 0.0.0.0 makes the server reachable from other devices on the same Wi-Fi
  // (a phone), not just from this machine.
  httpServer.listen(port, "0.0.0.0", (err) => {
    if (err) throw err;
    const protocol = isDev ? "https" : "http";
    console.log(`> Server running on ${protocol}://localhost:${port}`);
    if (isDev) {
      for (const ip of getLocalNetworkIPs()) {
        console.log(`> On your phone (same Wi-Fi): ${protocol}://${ip}:${port}`);
      }
    }
  });

  // Forward WebSocket upgrade requests (Turbopack/webpack HMR) to Next's dev server.
  // Without this, the custom Express server never establishes the HMR socket,
  // which can leave the client stuck mid hot-reload and surface stray DOM
  // reconciliation errors after edits are applied.
  if (isDev) {
    httpServer.on("upgrade", app.getUpgradeHandler());
  }
});
