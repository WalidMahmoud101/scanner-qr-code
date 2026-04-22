const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const crypto = require("crypto");
const Database = require("better-sqlite3");
const { writeBurgundyLabelPng } = require("./lib/burgundy-label");
const { qrPngBasename } = require("./lib/qr-filename");
const { expectedSlotsFromPacks, getPackRanges } = require("./lib/qr-pack-ranges");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data");
/** نفس مجلد القاعدة (مهم مع قرص Render الدائم) — مش public/qrcodes عشان ما يضيعش مع إعادة التشغيل */
const QR_DIR = path.join(DATA_DIR, "qrcodes");
const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");
const DB_PATH = path.join(DATA_DIR, "app.db");
/** عدد أكواد QR عندما لا يُستخدم SEED_SLOT_RANGES (سلوتات 1..COUNT) */
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

/**
 * مثال: SEED_SLOT_RANGES=4110:75,5105:95
 * يعني 75 كود من 4110 (UAE) و 95 من 5105 (EGY) — بدون تكرار في الأرقام.
 */
function parseSeedSlotRanges() {
  const raw = (process.env.SEED_SLOT_RANGES || "").trim();
  if (!raw) {
    return null;
  }
  const slots = [];
  const seen = new Set();
  for (const part of raw.split(",")) {
    const p = part.trim();
    if (!p) {
      continue;
    }
    const bits = p.split(":");
    if (bits.length !== 2) {
      throw new Error(`SEED_SLOT_RANGES: مقطع غير صالح "${p}" — استخدم start:count`);
    }
    const start = Number.parseInt(bits[0].trim(), 10);
    const count = Number.parseInt(bits[1].trim(), 10);
    if (!Number.isFinite(start) || !Number.isFinite(count) || start < 1 || count < 1) {
      throw new Error(`SEED_SLOT_RANGES: start أو count غير صالح في "${p}"`);
    }
    if (start > 99999 || start + count - 1 > 99999) {
      throw new Error("SEED_SLOT_RANGES: الأرقام يجب أن تبقى ضمن 1..99999");
    }
    for (let i = 0; i < count; i++) {
      const s = start + i;
      if (seen.has(s)) {
        throw new Error(`SEED_SLOT_RANGES: تكرار لرقم السلوت ${s}`);
      }
      seen.add(s);
      slots.push(s);
    }
  }
  if (!slots.length) {
    return null;
  }
  slots.sort((a, b) => a - b);
  return slots;
}

function getExpectedSlots() {
  const fromRanges = parseSeedSlotRanges();
  if (fromRanges) {
    return fromRanges;
  }
  try {
    return expectedSlotsFromPacks(DATA_DIR);
  } catch (e) {
    console.error("[seed] فشل نطاق UA/EGY (تحقق من QR_UA_* و QR_EGY_* في .env):", e.message);
    throw e;
  }
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
    const out = path.join(QR_DIR, qrPngBasename(slot));
    await writeBurgundyLabelPng({ url, slot, outPath: out });
  }
  const manifest = all.map(({ slot, token: tok }) => ({
    slot,
    token: tok,
    url: `${PUBLIC_URL}/r/${encodeURIComponent(tok)}`,
    file: `qrcodes/${qrPngBasename(slot)}`,
  }));
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Wrote ${all.length} QR PNGs + manifest → ${MANIFEST_PATH} (PUBLIC_URL=${PUBLIC_URL}).`);
}

async function main() {
  const expectedSlots = getExpectedSlots();
  const rangesRaw = (process.env.SEED_SLOT_RANGES || "").trim();
  let packLine = "| SEED_CODE_COUNT → " + COUNT;
  if (rangesRaw) {
    packLine = "| SEED_SLOT_RANGES → " + rangesRaw;
  } else {
    try {
      packLine = "| UA+EGY packs → " + getPackRanges(DATA_DIR).seedSlotRangesString;
    } catch (e) {
      packLine = "| UA+EGY packs → (خطأ: " + e.message + ")";
    }
  }
  console.log("[seed] DATA_DIR →", DATA_DIR, packLine);
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

  const existingRows = db.prepare("SELECT slot FROM codes ORDER BY slot").all();
  const dbSlotsSorted = existingRows.map((r) => r.slot);
  const sameSet =
    dbSlotsSorted.length === expectedSlots.length &&
    dbSlotsSorted.every((s, i) => s === expectedSlots[i]);

  if (sameSet && !FORCE) {
    console.log(
      `Database matches expected ${expectedSlots.length} slot(s) — refreshing QR PNGs + manifest only (tokens unchanged). Use FORCE_SEED=1 to replace all tokens.`
    );
    await writeQrFilesAndManifest(db);
    db.close();
    return;
  }

  if (!sameSet && existingRows.length > 0 && !FORCE) {
    const expectedSet = new Set(expectedSlots);
    const dbInExpected = dbSlotsSorted.every((s) => expectedSet.has(s));
    const additiveExpand =
      dbInExpected && expectedSlots.length > dbSlotsSorted.length;
    if (!additiveExpand) {
      console.error("[seed] قاعدة البيانات فيها سلوتات مختلفة عن الإعداد الحالي (أو تقليل العدد يتطلب حذف صفوف).");
      console.error("  المتوقع:", expectedSlots.length, "صف — أول سلوتات:", expectedSlots.slice(0, 6).join(", "), "…");
      console.error("  الموجود في DB:", existingRows.length, "صف");
      console.error("  لإعادة التوليد بالكامل: FORCE_SEED=1 npm run seed");
      db.close();
      process.exit(1);
    }
    console.log(
      `[seed] إضافة ${expectedSlots.length - dbSlotsSorted.length} كود جديد فقط (كل السلوتات الموجودة ضمن النطاق الجديد — التوكنات القديمة لا تتغير).`
    );
  }

  if (FORCE) {
    db.exec("DELETE FROM codes");
    for (const f of fs.readdirSync(QR_DIR)) {
      if (f.endsWith(".png")) {
        fs.unlinkSync(path.join(QR_DIR, f));
      }
    }
  }

  const insert = db.prepare(
    "INSERT INTO codes (slot, token, used, used_at) VALUES (?, ?, 0, NULL)"
  );

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      insert.run(row.slot, row.token);
    }
  });

  const rows = [];
  const usedTokens = new Set(
    db
      .prepare("SELECT token FROM codes")
      .all()
      .map((r) => r.token)
  );

  for (const slot of expectedSlots) {
    if (!FORCE) {
      const row = db.prepare("SELECT token FROM codes WHERE slot = ?").get(slot);
      if (row) {
        continue;
      }
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
