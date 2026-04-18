const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const { execFileSync } = require("child_process");
const os = require("os");
const http = require("http");
const https = require("https");
const express = require("express");
const helmet = require("helmet");
const Database = require("better-sqlite3");
const selfsigned = require("selfsigned");

const ROOT = __dirname;
const DB_PATH = path.join(ROOT, "data", "app.db");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const USE_HTTPS = process.env.USE_HTTPS !== "0";
/** When HTTPS is on: extra HTTP port without TLS (Cursor / ERR_CERT). Set HTTP_EXTRA_PORT=0 to disable. */
const HTTP_EXTRA_PORT =
  process.env.HTTP_EXTRA_PORT === "0" ? null : Number(process.env.HTTP_EXTRA_PORT) || PORT + 1;

function getDashboardCreds() {
  return {
    user: process.env.DASHBOARD_USER || "admin",
    pass: process.env.DASHBOARD_PASS || "changeme",
  };
}

function isPublicPath(req) {
  const p = (req.path || "").split("?")[0];
  if (req.method === "POST" && p === "/api/scan") {
    return true;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }
  if (p === "/health") {
    return true;
  }
  if (p === "/scan.html") {
    return true;
  }
  if (p.startsWith("/r/")) {
    return true;
  }
  if (p.startsWith("/qrcodes/")) {
    return true;
  }
  if (p === "/styles.css") {
    return true;
  }
  if (p === "/feedback.js") {
    return true;
  }
  return false;
}

function parseBasicAuth(header) {
  if (!header || typeof header !== "string" || !header.startsWith("Basic ")) {
    return null;
  }
  try {
    const raw = Buffer.from(header.slice(6), "base64").toString("utf8");
    const i = raw.indexOf(":");
    if (i === -1) {
      return { user: raw, pass: "" };
    }
    return { user: raw.slice(0, i), pass: raw.slice(i + 1) };
  } catch {
    return null;
  }
}

function protectDashboard(req, res, next) {
  if (isPublicPath(req)) {
    return next();
  }
  const { user: expectUser, pass: expectPass } = getDashboardCreds();
  const got = parseBasicAuth(req.headers.authorization);
  const ok = got && got.user === expectUser && got.pass === expectPass;
  if (!ok) {
    res.setHeader("WWW-Authenticate", 'Basic realm="QR Dashboard"');
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    return res
      .status(401)
      .type("text/plain; charset=utf-8")
      .send("يجب تسجيل الدخول (لوحة التحكم).");
  }
  next();
}

/** Block probes for secrets even if static config ever changes (defence in depth). */
function blockSensitivePaths(req, res, next) {
  let full = req.originalUrl || req.url || "";
  try {
    full = decodeURIComponent(full);
  } catch {
    /* ignore */
  }
  const lower = full.toLowerCase();
  if (lower.includes("..")) {
    return res.status(404).end();
  }
  const blocked = [
    ".env",
    ".git",
    "node_modules",
    "/data/",
    ".sqlite",
    ".pem",
    ".crt",
    "package-lock.json",
  ];
  for (const b of blocked) {
    if (lower.includes(b)) {
      return res.status(404).end();
    }
  }
  next();
}

const app = express();
app.disable("x-powered-by");
if (process.env.RENDER_EXTERNAL_URL) {
  app.set("trust proxy", 1);
}
app.use(blockSensitivePaths);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: "16kb" }));
app.get("/health", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});
app.use(protectDashboard);

app.get("/qrcodes-all.zip", (_req, res) => {
  const publicDir = path.join(ROOT, "public");
  const qDir = path.join(publicDir, "qrcodes");
  const zipPath = path.join(publicDir, "qrcodes-all.zip");
  if (!fs.existsSync(qDir)) {
    res.status(404).type("text/plain").send("Missing public/qrcodes — run npm run seed first.");
    return;
  }
  const pngs = fs.readdirSync(qDir).filter((f) => f.endsWith(".png"));
  if (!pngs.length) {
    res.status(404).type("text/plain").send("No PNGs in public/qrcodes — run npm run seed.");
    return;
  }
  try {
    execFileSync("zip", ["-qr", "qrcodes-all.zip", "qrcodes"], {
      cwd: publicDir,
      stdio: "ignore",
    });
  } catch {
    res.status(500).type("text/plain").send("zip command failed.");
    return;
  }
  res.download(zipPath, "qrcodes-all.zip");
});

app.use(express.static(path.join(ROOT, "public")));

function html(title, bodyClass, heading, message, sub) {
  const vibHintAr =
    bodyClass === "ok" || bodyClass === "warn"
      ? `<p class="sub" dir="rtl" style="margin-top:0.75rem;font-size:0.88rem;line-height:1.45">ستسمع نغمتين قصيرتين (أو اهتزازاً على أندرويد)، ويومض الإطار — سفاري الآيفون لا يدعم هزاز الويب عادةً.</p>`
      : "";
  const vibScript = `<script src="/feedback.js"></script><script>(function(){var m=document.body.className.match(/\\b(ok|warn|bad)\\b/);if(m&&window.feedbackScanResult)window.feedbackScanResult(m[1]);})();<\/script>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body class="${bodyClass}">
  <main class="card">
    <h1>${heading}</h1>
    <p class="msg">${message}</p>
    ${sub ? `<p class="sub">${sub}</p>` : ""}
    ${vibHintAr}
  </main>
  ${vibScript}
</body>
</html>`;
}

function getDb() {
  if (!fs.existsSync(DB_PATH)) {
    return null;
  }
  return new Database(DB_PATH, { readonly: false });
}

/** @returns {{ outcome: "registered", slot: number } | { outcome: "already", slot: number } | { outcome: "not_found" }} */
function tryRegisterToken(db, rawToken) {
  const row = db.prepare("SELECT slot FROM codes WHERE token = ?").get(rawToken);
  if (!row) {
    return { outcome: "not_found" };
  }
  const now = new Date().toISOString();
  const info = db
    .prepare("UPDATE codes SET used = 1, used_at = ? WHERE token = ? AND used = 0")
    .run(now, rawToken);
  if (info.changes === 0) {
    return { outcome: "already", slot: row.slot };
  }
  return { outcome: "registered", slot: row.slot };
}

function parseTokenFromScanPayload(text) {
  if (!text || typeof text !== "string") {
    return null;
  }
  const t = text.trim();
  const m = t.match(/\/r\/([^/?#]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  if (/^[A-Za-z0-9_-]+$/.test(t) && t.length >= 8) {
    return t;
  }
  return null;
}

app.post("/api/scan", (req, res) => {
  const rawPayload =
    (req.body && (req.body.raw ?? req.body.text ?? req.body.data ?? req.body.token)) || "";
  const token = parseTokenFromScanPayload(String(rawPayload));
  if (!token) {
    res.status(400).json({ ok: false, error: "invalid_payload" });
    return;
  }

  const db = getDb();
  if (!db) {
    res.status(503).json({ ok: false, error: "no_database" });
    return;
  }

  try {
    const result = tryRegisterToken(db, token);
    if (result.outcome === "not_found") {
      res.status(404).json({ ok: false, error: "invalid_token" });
      return;
    }
    if (result.outcome === "already") {
      res.json({
        ok: true,
        status: "already_registered",
        slot: result.slot,
        message: "Already registered",
        messageAr: "مسجّل مسبقاً — هذا الرمز اتستخدم قبل كده.",
      });
      return;
    }
    res.json({
      ok: true,
      status: "registered",
      slot: result.slot,
      message: "Registered successfully",
      messageAr: "تم التسجيل — أول مرة للرمز ده.",
    });
  } finally {
    db.close();
  }
});

app.get("/r/:token", (req, res) => {
  const raw = req.params.token;
  const db = getDb();
  if (!db) {
    res.status(503).send(
      html(
        "Setup required",
        "bad",
        "Database missing",
        "Run <code>npm run seed</code> once, then restart the server.",
        ""
      )
    );
    return;
  }

  try {
    const result = tryRegisterToken(db, raw);
    if (result.outcome === "not_found") {
      res.status(404).send(
        html(
          "Not found",
          "bad",
          "Invalid QR",
          "This code is not recognized.",
          ""
        )
      );
      return;
    }

    if (result.outcome === "already") {
      res
        .status(200)
        .send(
          html(
            "Already registered",
            "warn",
            "Already registered",
            "This QR was scanned before. Each code works only once.",
            `Code #${result.slot}`
          )
        );
      return;
    }

    res.send(
      html(
        "Registered",
        "ok",
        "Registered successfully",
        "Your scan has been recorded.",
        `Code #${result.slot}`
      )
    );
  } finally {
    db.close();
  }
});

app.get("/api/status", (_req, res) => {
  const db = getDb();
  if (!db) {
    res.json({ ok: false, error: "no_database" });
    return;
  }
  try {
    const total = db.prepare("SELECT COUNT(*) AS c FROM codes").get().c;
    const used = db.prepare("SELECT COUNT(*) AS c FROM codes WHERE used = 1").get().c;
    res.json({ ok: true, total, used, remaining: total - used });
  } finally {
    db.close();
  }
});

app.get("/api/codes", (_req, res) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ ok: false, error: "no_database" });
    return;
  }
  try {
    const rows = db
      .prepare(
        "SELECT slot, token, used, used_at FROM codes ORDER BY slot"
      )
      .all();
    res.json({ ok: true, codes: rows });
  } finally {
    db.close();
  }
});

app.post("/api/reset-usage", (_req, res) => {
  const db = getDb();
  if (!db) {
    res.status(503).json({ ok: false, error: "no_database" });
    return;
  }
  try {
    const n = db.prepare("UPDATE codes SET used = 0, used_at = NULL").run().changes;
    res.json({ ok: true, reset: n });
  } finally {
    db.close();
  }
});

function lanIPv4s() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === "IPv4" && !n.internal) {
        out.add(n.address);
      }
    }
  }
  return [...out];
}

function devHttpsPaths() {
  return {
    key: path.join(ROOT, "data", "dev-https-key.pem"),
    cert: path.join(ROOT, "data", "dev-https-cert.pem"),
  };
}

function getHttpsCreds() {
  const certPath = process.env.SSL_CERT_PATH;
  const keyPath = process.env.SSL_KEY_PATH;
  if (certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    console.log("[https] Using SSL_CERT_PATH + SSL_KEY_PATH (production / Let's Encrypt)");
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  }
  return loadOrCreateDevHttpsCreds();
}

function loadOrCreateDevHttpsCreds() {
  const { key: keyPath, cert: certPath } = devHttpsPaths();
  if (process.env.REGEN_DEV_CERT === "1") {
    try {
      fs.unlinkSync(keyPath);
    } catch {
      /* noop */
    }
    try {
      fs.unlinkSync(certPath);
    } catch {
      /* noop */
    }
  }
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
  const altNames = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...lanIPv4s().map((ip) => ({ type: 7, ip })),
  ];
  const pems = selfsigned.generate([{ name: "commonName", value: "qr-local-dev" }], {
    keySize: 2048,
    days: 825,
    algorithm: "sha256",
    extensions: [{ name: "subjectAltName", altNames: altNames }],
  });
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

function logDashboardHint() {
  const { user, pass } = getDashboardCreds();
  console.log(`[dashboard] مسح QR عام: /scan.html و /r/... بدون كلمة سر.`);
  console.log(`[dashboard] لوحة التحكم محمية: المستخدم "${user}"`);
  if (!process.env.DASHBOARD_PASS) {
    console.log(
      `[dashboard] كلمة السر الافتراضية: "${pass}" — أنشئ ملف .env من .env.example وغيّر DASHBOARD_PASS`
    );
  } else {
    console.log(`[dashboard] كلمة السر من متغير البيئة DASHBOARD_PASS`);
  }
}

if (USE_HTTPS) {
  const creds = getHttpsCreds();
  https.createServer(creds, app).listen(PORT, HOST, () => {
    console.log(`HTTPS (camera on phone / Chrome over LAN):`);
    console.log(`  https://127.0.0.1:${PORT}`);
    for (const ip of lanIPv4s()) {
      console.log(`  https://${ip}:${PORT}`);
    }
    console.log(`If you see ERR_CERT_AUTHORITY_INVALID (e.g. Cursor preview), use HTTP below instead.`);
    logDashboardHint();
  });
  if (HTTP_EXTRA_PORT != null) {
    http
      .createServer(app)
      .on("error", (err) => {
        console.error(`[http-extra:${HTTP_EXTRA_PORT}]`, err.message);
      })
      .listen(HTTP_EXTRA_PORT, HOST, () => {
        console.log(`HTTP — no certificate (fixes ERR_CERT in embedded browsers):`);
        console.log(`  http://127.0.0.1:${HTTP_EXTRA_PORT}`);
        for (const ip of lanIPv4s()) {
          console.log(`  http://${ip}:${HTTP_EXTRA_PORT}`);
        }
        console.log(`Camera: works on localhost HTTP; on phone use https:${PORT} if camera fails.`);
      });
  }
} else {
  http.createServer(app).listen(PORT, HOST, () => {
    console.log(`HTTP http://127.0.0.1:${PORT}`);
    console.log(`Camera in Chrome works on localhost only. Use default npm start (HTTPS) for LAN + camera.`);
    logDashboardHint();
  });
}
