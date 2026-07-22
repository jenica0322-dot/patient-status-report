require("dotenv").config();
const express = require("express");
const next = require("next");
const bodyParser = require("body-parser");

const isDev = process.env.NODE_ENV !== "production";
const port = isDev ? 3099 : process.env.PORT || 3003;
const app = next({ dev: isDev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = express();

  server.use(bodyParser.json());

  server.use('/api/auth', require('./routes/auth'));
  server.use('/api', require('./routes/dataRoutes'));

  console.log(`Running in ${isDev ? "development" : "production"} mode...`);

  server.all("*", (req, res) => {
    return handle(req, res);
  });

  const httpServer = server.listen(port, (err) => {
    if (err) throw err;
    console.log(`> Server running on http://localhost:${port}`);
  });

  // Forward WebSocket upgrade requests (Turbopack/webpack HMR) to Next's dev server.
  // Without this, the custom Express server never establishes the HMR socket,
  // which can leave the client stuck mid hot-reload and surface stray DOM
  // reconciliation errors after edits are applied.
  if (isDev) {
    httpServer.on("upgrade", app.getUpgradeHandler());
  }
});
