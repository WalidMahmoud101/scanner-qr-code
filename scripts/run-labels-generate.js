/**
 * Runs QR-Burgundy-Labels/generate.js using manifest.json (DATA_DIR/manifest.json أو public/manifest.json).
 * Tokens live only in Site Qr Code (seed); Burgundy only draws label PNGs into its output/.
 *
 * .env (في مجلد مشروع الموقع):
 *   QR_LABELS_DIR=/Users/dozzy/Desktop/QR-Burgundy-Labels
 *
 * لو ظهر «لم يُعثر»: شغّل من Terminal خارج Cursor أو تأكد إن المسار صحيح (السكربت يطبع كل مسار جرّبناه).
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ROOT = path.join(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data");
const manifestPrimary = path.join(DATA_DIR, "manifest.json");
const manifestFallback = path.join(ROOT, "public", "manifest.json");
const manifest = fs.existsSync(manifestPrimary)
  ? manifestPrimary
  : fs.existsSync(manifestFallback)
    ? manifestFallback
    : manifestPrimary;

function normalizeDir(s) {
  if (s == null || typeof s !== "string") {
    return "";
  }
  return s
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\r$/g, "");
}

const candidates = [];
const envDir = normalizeDir(process.env.QR_LABELS_DIR);
if (envDir) {
  candidates.push(envDir);
}
candidates.push(path.join(ROOT, "..", "QR-Burgundy-Labels"));
candidates.push(path.join(os.homedir(), "Desktop", "QR-Burgundy-Labels"));
candidates.push(path.join(os.homedir(), "Documents", "QR-Burgundy-Labels"));

const seen = new Set();
const unique = [];
for (const c of candidates) {
  const key = path.resolve(c);
  if (seen.has(key)) {
    continue;
  }
  seen.add(key);
  unique.push(c);
}

let labelsDir = null;
const tried = [];
for (const c of unique) {
  const resolved = path.resolve(c);
  const genPath = path.join(resolved, "generate.js");
  const ok = fs.existsSync(genPath);
  tried.push({ resolved, ok });
  if (ok) {
    labelsDir = resolved;
    break;
  }
}

if (!labelsDir) {
  console.error("لم يُعثر على مشروع الليبلز (ملف generate.js).");
  console.error("المسارات التي تمت تجربتها:");
  for (const { resolved, ok } of tried) {
    console.error(ok ? "  [موجود]" : "  [غير موجود]", resolved);
  }
  console.error("");
  console.error("المسح من الموقع لا يعتمد على Burgundy — يعتمد على أن الرابط داخل الـ QR يطابق التوكن في قاعدة Render.");
  console.error("ضبط المسار: في ملف .env داخل مجلد «Site Qr Code» أضف سطرًا بدون مسافات زائدة:");
  console.error("  QR_LABELS_DIR=/المسار/الكامل/QR-Burgundy-Labels");
  process.exit(1);
}

if (!fs.existsSync(manifest)) {
  console.error("لا يوجد manifest.json — شغّل أولاً: npm run seed");
  console.error("المتوقع:", manifestPrimary, "أو", manifestFallback);
  process.exit(1);
}

const gen = path.join(labelsDir, "generate.js");
console.log("[labels] مجلد المولّد:", labelsDir);
console.log("[labels] manifest:", manifest);

const r = spawnSync(process.execPath, [gen, manifest], {
  cwd: labelsDir,
  stdio: "inherit",
  env: { ...process.env, MANIFEST_PATH: manifest },
});

process.exit(r.status === null ? 1 : r.status);
