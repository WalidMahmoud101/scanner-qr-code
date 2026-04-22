const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const fs = require("fs");
const { spawnSync } = require("child_process");
const os = require("os");
const http = require("http");
const https = require("https");
const express = require("express");
const helmet = require("helmet");
const Database = require("better-sqlite3");
const selfsigned = require("selfsigned");
const { qrPngBasename, resolveQrPngPath } = require("./scripts/lib/qr-filename");
const qrPacks = require("./scripts/lib/qr-pack-ranges");
const { streamZipToResponse } = require("./scripts/lib/stream-zip");

const ROOT = __dirname;
/** SQLite + أي ملفات data؛ على Render مع قرص دائم: اضبط DATA_DIR=/var/data (نفس mountPath للقرص) */
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "app.db");
const QR_CODES_DIR = path.join(DATA_DIR, "qrcodes");
const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
/** Render terminates TLS at the edge and forwards plain HTTP to PORT — listening with HTTPS here yields 502. */
const ON_RENDER = process.env.RENDER === "true";
const USE_HTTPS = !ON_RENDER && process.env.USE_HTTPS !== "0";
/** When HTTPS is on: extra HTTP port without TLS (Cursor / ERR_CERT). Set HTTP_EXTRA_PORT=0 to disable. */
const HTTP_EXTRA_PORT =
  process.env.HTTP_EXTRA_PORT === "0" || ON_RENDER
    ? null
    : Number(process.env.HTTP_EXTRA_PORT) || PORT + 1;

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
  if (p.startsWith("/api/qr-image/")) {
    return true;
  }
  /** تحميل ZIP / manifest بدون Basic Auth — المتصفح لا ي reliably يرسل الهوية مع <a download> */
  if (
    p === "/qrcodes-all.zip" ||
    p === "/qrcodes-egy.zip" ||
    p === "/qrcodes-ua.zip" ||
    p === "/manifest.json"
  ) {
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
    /** يسمح للمتصفحات / CDNs بتحميل الملفات المرفقة بدون سلوك غريب */
    crossOriginResourcePolicy: false,
  })
);
app.use(express.json({ limit: "16kb" }));
app.get("/health", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});
app.use(protectDashboard);

function headZipAttachment(res, downloadName) {
  const safe = String(downloadName).replace(/[^\w.\-]/g, "_") || "download.zip";
  res.status(200);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end();
}

app.head("/qrcodes-all.zip", (_req, res) => {
  headZipAttachment(res, "qrcodes-all.zip");
});
app.head("/qrcodes-egy.zip", (_req, res) => {
  try {
    headZipAttachment(res, qrPacks.getPackRanges(DATA_DIR).zipEgy.downloadName);
  } catch (e) {
    res.status(500).end();
  }
});
app.head("/qrcodes-ua.zip", (_req, res) => {
  try {
    headZipAttachment(res, qrPacks.getPackRanges(DATA_DIR).zipUa.downloadName);
  } catch (e) {
    res.status(500).end();
  }
});

async function sendQrRangeZip(_req, res, spec) {
  const { start, count, downloadName } = spec;
  const qDir = QR_CODES_DIR;
  if (!fs.existsSync(qDir)) {
    res.status(404).type("text/plain").send("Missing QR folder — run npm run seed first.");
    return;
  }
  const files = [];
  for (let i = 0; i < count; i++) {
    const slot = start + i;
    const canonical = qrPngBasename(slot);
    const resolved = resolveQrPngPath(qDir, slot);
    if (!resolved) {
      res.status(404).type("text/plain; charset=utf-8").send(
        `Missing PNG for slot ${slot} (expected ${canonical} or legacy name on disk). Run: npm run seed`
      );
      return;
    }
    files.push({ absPath: resolved.absPath, entryName: `qrcodes/${canonical}` });
  }
  await streamZipToResponse(res, downloadName, files);
}

app.get("/qrcodes-egy.zip", async (req, res) => {
  try {
    await sendQrRangeZip(req, res, qrPacks.getPackRanges(DATA_DIR).zipEgy);
  } catch (e) {
    console.error("[qrcodes-egy.zip]", e);
    if (!res.headersSent) {
      res.status(500).type("text/plain; charset=utf-8").send(e.message || "range error");
    }
  }
});

app.get("/qrcodes-ua.zip", async (req, res) => {
  try {
    await sendQrRangeZip(req, res, qrPacks.getPackRanges(DATA_DIR).zipUa);
  } catch (e) {
    console.error("[qrcodes-ua.zip]", e);
    if (!res.headersSent) {
      res.status(500).type("text/plain; charset=utf-8").send(e.message || "range error");
    }
  }
});

app.get("/qrcodes-all.zip", async (_req, res) => {
  const qDir = QR_CODES_DIR;
  if (!fs.existsSync(qDir)) {
    res.status(404).type("text/plain").send("Missing QR folder — run npm run seed first.");
    return;
  }
  const pngs = fs.readdirSync(qDir).filter((f) => f.endsWith(".png"));
  if (!pngs.length) {
    res.status(404).type("text/plain").send("No PNGs in data qrcodes folder — run npm run seed.");
    return;
  }
  const dbZip = getDb();
  if (dbZip) {
    try {
      const dbTotal = dbZip.prepare("SELECT COUNT(*) AS c FROM codes").get().c;
      if (dbTotal !== pngs.length) {
        console.warn(
          `[qrcodes-all.zip] mismatch: ${pngs.length} PNG files vs ${dbTotal} DB rows — ZIP may be incomplete; run npm run seed on the server`
        );
      }
    } finally {
      dbZip.close();
    }
  }
  const files = pngs.map((f) => ({
    absPath: path.join(qDir, f),
    entryName: `qrcodes/${f}`,
  }));
  try {
    await streamZipToResponse(res, "qrcodes-all.zip", files);
  } catch (e) {
    console.error("[qrcodes-all.zip]", e);
    if (!res.headersSent) {
      res.status(500).type("text/plain").send("zip build failed.");
    }
  }
});

app.use((req, res, next) => {
  if (req.method === "GET" && (req.path === "/scan.html" || req.path === "/admin.html")) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
  }
  if (req.method === "GET" && req.path.startsWith("/qrcodes/") && /\.png$/i.test(req.path)) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
  }
  next();
});

app.get("/manifest.json", (req, res, next) => {
  const primary = MANIFEST_PATH;
  const fallback = path.join(ROOT, "public", "manifest.json");
  const p = fs.existsSync(primary) ? primary : fs.existsSync(fallback) ? fallback : null;
  if (!p) {
    return next();
  }
  res.type("application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.send(fs.readFileSync(p, "utf8"));
});

/** لو الطلب /qrcodes/04110.png والملف على القرص اسمه 4110.png — حوّل للاسم الموجود */
app.use("/qrcodes", (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return next();
  }
  const urlPath = (req.originalUrl || req.url || "").split("?")[0];
  const m = urlPath.match(/\/qrcodes\/([^/]+\.png)$/i);
  if (!m) {
    return next();
  }
  const requested = m[1];
  const direct = path.join(QR_CODES_DIR, requested);
  if (fs.existsSync(direct)) {
    return next();
  }
  const slotMatch = requested.match(/^0*(\d+)\.png$/i);
  if (!slotMatch) {
    return next();
  }
  const slot = Number(slotMatch[1]);
  const resolved = resolveQrPngPath(QR_CODES_DIR, slot);
  if (!resolved || resolved.basenameOnDisk === requested) {
    return next();
  }
  res.redirect(302, `/qrcodes/${resolved.basenameOnDisk}`);
});

app.use("/qrcodes", express.static(QR_CODES_DIR));
app.use(express.static(path.join(ROOT, "public")));

function html(title, bodyClass, heading, message, sub) {
  const vibHintAr =
    bodyClass === "ok" || bodyClass === "warn"
      ? `<p class="sub" dir="rtl" style="margin-top:0.75rem;font-size:0.88rem;line-height:1.45">أندرويد: نغمة + اهتزاز. آيفون / سفاري: نغمة (يفضّل تشغيل المسح من زر الكاميرا أولاً) + وميض الإطار مرتين — لا يوجد هزاز للمواقع (قيود Apple).</p>`
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
  try {
    const db = new Database(DB_PATH, { readonly: false });
    return db;
  } catch (e) {
    console.error("[db] open failed:", e);
    return null;
  }
}

function sanitizeScanText(text) {
  return String(text)
    .trim()
    .replace(/[\r\n\u2028\u2029]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/^<+|>+$/g, "")
    .trim()
    .replace(/[\s\u00A0]+$/g, "")
    .replace(/[,，.。』」）)\]}>]+$/g, "");
}

/**
 * Extract registration token from scanned QR text (full URL or bare base64url token).
 */
function parseTokenFromScanPayload(text) {
  const t0 = sanitizeScanText(text);
  if (!t0) {
    return null;
  }
  const urlLike = t0.match(/https?:\/\/[^\s<>]+/i);
  const t = urlLike ? urlLike[0] : t0;
  const m = t.match(/\/r\/([^/?#]+)/i);
  if (m) {
    let seg = m[1];
    for (let i = 0; i < 4; i++) {
      try {
        const next = decodeURIComponent(seg);
        if (next === seg) {
          break;
        }
        seg = next;
      } catch {
        break;
      }
    }
    return seg || null;
  }
  if (/^[A-Za-z0-9_-]+$/.test(t0) && t0.length >= 8) {
    return t0;
  }
  return null;
}

/** Try DB with primary token and URL-decoding variants (scanner / proxy quirks). */
function tokenLookupCandidates(primary) {
  const out = [];
  const add = (s) => {
    if (s == null || s === "") {
      return;
    }
    if (!out.includes(s)) {
      out.push(s);
    }
  };
  add(primary);
  const noWs = primary.replace(/\s+/g, "");
  if (noWs !== primary) {
    add(noWs);
  }
  try {
    const nfc = primary.normalize("NFKC");
    if (nfc !== primary) {
      add(nfc);
    }
  } catch {
    /* ignore */
  }
  let p = primary;
  for (let i = 0; i < 4; i++) {
    try {
      const n = decodeURIComponent(p);
      if (n === p) {
        break;
      }
      add(n);
      p = n;
    } catch {
      break;
    }
  }
  return out;
}

function findCodeRowByCandidates(db, candidates) {
  for (const v of candidates) {
    const row = db.prepare("SELECT slot, token FROM codes WHERE token = ?").get(v);
    if (row) {
      return row;
    }
  }
  return null;
}

/** @returns {{ outcome: "registered", slot: number } | { outcome: "already", slot: number } | { outcome: "not_found" }} */
function tryRegisterToken(db, primaryToken) {
  const candidates = tokenLookupCandidates(primaryToken);
  const row = findCodeRowByCandidates(db, candidates);
  if (!row) {
    return { outcome: "not_found" };
  }
  const dbToken = row.token;
  const now = new Date().toISOString();
  const info = db
    .prepare("UPDATE codes SET used = 1, used_at = ? WHERE token = ? AND used = 0")
    .run(now, dbToken);
  if (info.changes === 0) {
    return { outcome: "already", slot: row.slot };
  }
  return { outcome: "registered", slot: row.slot };
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
      let dbRows = 0;
      try {
        dbRows = db.prepare("SELECT COUNT(*) AS c FROM codes").get().c;
      } catch {
        /* noop */
      }
      console.warn(
        `[api/scan] invalid_token tokenLen=${token.length} dbRows=${dbRows} host=${req.get("host") || ""}`
      );
      res.status(404).json({
        ok: false,
        error: "invalid_token",
        hintAr:
          "التوكن في الـ QR مش في قاعدة السيرفر الحالية. من Render Shell شغّل: npm run seed ثم امسح QR من الأدمن أو حمّل ZIP من الموقع (طباعة قديمة = غالبًا غلط).",
        hintEn:
          "This QR token is not in the live database. In Render Shell run: npm run seed — then scan a QR from Admin or re-download the ZIP. Old prints often mismatch after a new seed.",
      });
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
  } catch (e) {
    console.error("[api/scan]", e);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "server_error" });
    }
  } finally {
    try {
      db.close();
    } catch {
      /* noop */
    }
  }
});

app.get("/r/:token", (req, res) => {
  const raw = sanitizeScanText(String(req.params.token || ""));
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
    let qrPngCount = 0;
    try {
      if (fs.existsSync(QR_CODES_DIR)) {
        qrPngCount = fs.readdirSync(QR_CODES_DIR).filter((f) => f.endsWith(".png")).length;
      }
    } catch {
      qrPngCount = 0;
    }
    let qrPackSummary = null;
    try {
      const p = qrPacks.getPackRanges(DATA_DIR);
      qrPackSummary = {
        uaRange: `${p.uaStart}…${p.uaEnd} (${p.uaCount})`,
        egyRange: `${p.egyStart}…${p.egyEnd} (${p.egyCount})`,
        uaExtra: p.uaExtra,
        egyExtra: p.egyExtra,
      };
    } catch {
      qrPackSummary = null;
    }
    res.json({
      ok: true,
      total,
      used,
      remaining: total - used,
      qrPngCount,
      imagesMatchDb: qrPngCount === total,
      qrPackSummary,
    });
  } finally {
    db.close();
  }
});

/** يوجّه لملف الليبلز (نفس تصميم Burgundy) بعد تشغيل npm run seed */
app.get("/api/qr-slot/:slot", (req, res) => {
  const slot = Number(req.params.slot);
  if (!Number.isFinite(slot) || slot < 1 || slot > 99999) {
    res.status(400).end();
    return;
  }
  const resolved = resolveQrPngPath(QR_CODES_DIR, slot);
  if (!resolved) {
    res.status(404).end();
    return;
  }
  res.redirect(302, `/qrcodes/${resolved.basenameOnDisk}`);
});

/** معاينة مصغّرة في الأدمن — يدعم أسماء ملفات قديمة على القرص */
app.get("/api/qr-image/:slot", (req, res) => {
  const slot = Number(req.params.slot);
  if (!Number.isFinite(slot) || slot < 1 || slot > 99999) {
    res.status(400).end();
    return;
  }
  const resolved = resolveQrPngPath(QR_CODES_DIR, slot);
  if (!resolved) {
    res.status(404).end();
    return;
  }
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.type("image/png");
  res.sendFile(path.resolve(resolved.absPath));
});

app.get("/api/qr-extra-counts", (_req, res) => {
  try {
    qrPacks.normalizeExtraCountsOnDisk(DATA_DIR);
    const base = qrPacks.getBasePacks();
    const extras = qrPacks.readExtraCounts(DATA_DIR);
    const p = qrPacks.getPackRanges(DATA_DIR);
    const seedEnvOverridesPacks = Boolean((process.env.SEED_SLOT_RANGES || "").trim());
    res.json({
      ok: true,
      seedEnvOverridesPacks,
      uaStart: p.uaStart,
      egyStart: p.egyStart,
      uaBaseCount: p.uaBaseCount,
      egyBaseCount: p.egyBaseCount,
      uaExtra: extras.uaExtra,
      egyExtra: extras.egyExtra,
      uaExtraEffective: p.uaExtra,
      uaExtraClamped: p.uaExtraClamped,
      uaCount: p.uaCount,
      egyCount: p.egyCount,
      uaEnd: p.uaEnd,
      egyEnd: p.egyEnd,
      maxUaExtra: qrPacks.maxUaExtraAllowed(base),
      seedSlotRangesString: p.seedSlotRangesString,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "range_error" });
  }
});

app.post("/api/qr-extra-counts", (req, res) => {
  try {
    const base = qrPacks.getBasePacks();
    const maxUa = qrPacks.maxUaExtraAllowed(base);
    const w = qrPacks.writeExtraCounts(DATA_DIR, {
      uaExtra: req.body && req.body.uaExtra,
      egyExtra: req.body && req.body.egyExtra,
    });
    const p = qrPacks.getPackRanges(DATA_DIR);
    res.json({
      ok: true,
      uaExtra: w.uaExtra,
      egyExtra: w.egyExtra,
      clampedUa: w.clampedUa,
      maxUaExtra: maxUa,
      uaEnd: p.uaEnd,
      egyEnd: p.egyEnd,
      uaCount: p.uaCount,
      egyCount: p.egyCount,
      seedSlotRangesString: p.seedSlotRangesString,
      messageAr:
        "تم الحفظ. الإمارات تظل أرقاماً منفصلة عن مصر (بدون تداخل). لتوليد صور وصفوف جديدة فقط: npm run seed (بدون FORCE). لإعادة توليد كل التوكنات من الصفر: FORCE_SEED=1 npm run seed.",
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || "bad_request" });
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

/** If SQLite DB is missing (e.g. fresh Render deploy), seed once using PUBLIC_URL or Render’s public URL. */
function ensureDatabase() {
  if (fs.existsSync(DB_PATH)) {
    return;
  }
  if (process.env.DISABLE_AUTO_SEED === "1") {
    console.warn(`[db] DISABLE_AUTO_SEED=1 — no DB at ${DB_PATH}; automatic seed skipped.`);
    return;
  }
  const publicBase = (
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ""
  ).replace(/\/$/, "");
  if (!publicBase) {
    console.warn(`[db] Missing DB at ${DB_PATH} — run: npm run seed (set PUBLIC_URL for correct QR links).`);
    return;
  }
  console.log(`[db] No database found; running seed with PUBLIC_URL=${publicBase} …`);
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "seed.js")], {
    cwd: ROOT,
    env: { ...process.env, PUBLIC_URL: publicBase },
    stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error("[db] Seed failed; scan/register will not work until seed succeeds.");
  } else {
    console.log("[db] Seed completed.");
  }
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

ensureDatabase();

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
