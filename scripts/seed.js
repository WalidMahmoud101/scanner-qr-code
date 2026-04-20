const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { writeBurgundyLabelPng } = require("./lib/burgundy-label");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data");
/** نفس مجلد القاعدة (مهم مع قرص Render الدائم) — مش public/qrcodes عشان ما يضيعش مع إعادة التشغيل */
const QR_DIR = path.join(DATA_DIR, "qrcodes");
const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");
const DB_PATH = path.join(DATA_DIR, "app.db");
/** عدد أكواد QR (يمكن تغييره من البيئة دون تعديل الكود) */
const COUNT = (() => {
  const n = Number.parseInt(process.env.SEED_CODE_COUNT || "500", 10);
  if (!Number.isFinite(n) || n < 1) return 500;
  return Math.min(99999, n);
})();
const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  "http://127.0.0.1:3000"
).replace(/\/$/, "");

const FORCE = process.env.FORCE_SEED === "1";

const publicUrlFromEnv = Boolean(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL);
if (!publicUrlFromEnv && PUBLIC_URL.includes("127.0.0.1") && process.env.RENDER !== "true") {
  console.warn(
    "[seed] لم يُضبط PUBLIC_URL (ولا RENDER_EXTERNAL_URL) — روابط الـ QR تستخدم http://127.0.0.1:3000.\n" +
      "  أضف في ملف .env: PUBLIC_URL=https://اسم-خدمتك.onrender.com"
  );
}

function token() {
  return crypto.randomBytes(16).toString("base64url");
}

/** Always rewrite PNGs + manifest from current DB so files match tokens (even when no new rows). */
async function writeQrFilesAndManifest(db) {
  fs.mkdirSync(QR_DIR, { recursive: true });
  /** يمسح أي PNG قديم (مثلاً تنسيق قديم أو عدد slots تغيّر) عشان ما يفضلش ملفان بيض في الآخر */
  for (const f of fs.readdirSync(QR_DIR)) {
    if (f.endsWith(".png")) {
      fs.unlinkSync(path.join(QR_DIR, f));
    }
  }
  const all = db.prepare("SELECT slot, token FROM codes ORDER BY slot").all();
  for (const { slot, token: tok } of all) {
    const url = `${PUBLIC_URL}/r/${encodeURIComponent(tok)}`;
    const out = path.join(QR_DIR, `${String(slot).padStart(3, "0")}.png`);
    await writeBurgundyLabelPng({ url, slot, outPath: out });
  }
  const manifest = all.map(({ slot, token: tok }) => ({
    slot,
    token: tok,
    url: `${PUBLIC_URL}/r/${encodeURIComponent(tok)}`,
    file: `qrcodes/${String(slot).padStart(3, "0")}.png`,
  }));
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Wrote ${all.length} QR PNGs + manifest → ${MANIFEST_PATH} (PUBLIC_URL=${PUBLIC_URL}).`);
}

async function main() {
  console.log("[seed] DATA_DIR →", DATA_DIR, "| SEED_CODE_COUNT →", COUNT);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(QR_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS codes (
      slot INTEGER PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      used INTEGER NOT NULL DEFAULT 0,
      used_at TEXT
    );
  `);

  const existing = db.prepare("SELECT COUNT(*) AS c FROM codes").get().c;
  if (existing >= COUNT && !FORCE) {
    console.log(
      `Database already has ${existing} codes — refreshing QR PNGs + manifest only (tokens unchanged). Use FORCE_SEED=1 to replace all tokens.`
    );
    await writeQrFilesAndManifest(db);
    db.close();
    return;
  }

  if (FORCE) {
    db.exec("DELETE FROM codes");
    for (const f of fs.readdirSync(QR_DIR)) {
      if (f.endsWith(".png")) fs.unlinkSync(path.join(QR_DIR, f));
    }
  }

  const insert = db.prepare(
    "INSERT INTO codes (slot, token, used, used_at) VALUES (?, ?, 0, NULL)"
  );

  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(row.slot, row.token);
  });

  const rows = [];
  const usedTokens = new Set(
    db
      .prepare("SELECT token FROM codes")
      .all()
      .map((r) => r.token)
  );

  for (let slot = 1; slot <= COUNT; slot++) {
    if (!FORCE) {
      const row = db.prepare("SELECT token FROM codes WHERE slot = ?").get(slot);
      if (row) continue;
    }
    let t;
    do {
      t = token();
    } while (usedTokens.has(t));
    usedTokens.add(t);
    rows.push({ slot, token: t });
  }

  if (rows.length) {
    insertMany(rows);
  }

  await writeQrFilesAndManifest(db);
  const n = db.prepare("SELECT COUNT(*) AS c FROM codes").get().c;
  console.log(`Seeded / updated ${n} codes. QR dir: ${QR_DIR}`);
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
