/**
 * Runs QR-Burgundy-Labels/generate.js using this project's public/manifest.json.
 * Tokens stay defined only in Site Qr Code (seed); labels project only draws PNGs.
 *
 * .env in this repo:
 *   QR_LABELS_DIR=/Users/dozzy/Desktop/QR-Burgundy-Labels
 * Or place a sibling folder named QR-Burgundy-Labels next to this project.
 */
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ROOT = path.join(__dirname, "..");
const manifest = path.join(ROOT, "public", "manifest.json");

const candidates = [];
if (process.env.QR_LABELS_DIR) {
  candidates.push(process.env.QR_LABELS_DIR);
}
candidates.push(path.join(ROOT, "..", "QR-Burgundy-Labels"));

let labelsDir = null;
for (const c of candidates) {
  const resolved = path.resolve(c);
  if (fs.existsSync(path.join(resolved, "generate.js"))) {
    labelsDir = resolved;
    break;
  }
}

if (!labelsDir) {
  console.error("لم يُعثر على مشروع الليبلز (ملف generate.js).");
  console.error("ضع في .env:");
  console.error('  QR_LABELS_DIR="/Users/dozzy/Desktop/QR-Burgundy-Labels"');
  console.error("أو ضع مجلد QR-Burgundy-Labels بجانب مجلد مشروع الموقع.");
  process.exit(1);
}

if (!fs.existsSync(manifest)) {
  console.error("لا يوجد public/manifest.json — شغّل أولاً: npm run seed");
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
