const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const ROOT = path.join(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, "data");
const qDir = path.join(DATA_DIR, "qrcodes");
const zipOut = path.join(ROOT, "public", "qrcodes-all.zip");

if (!fs.existsSync(qDir) || !fs.readdirSync(qDir).some((f) => f.endsWith(".png"))) {
  console.error("No PNGs in", qDir, "— run npm run seed first.");
  process.exit(1);
}
fs.mkdirSync(path.dirname(zipOut), { recursive: true });
execFileSync("zip", ["-qr", zipOut, "qrcodes"], { cwd: DATA_DIR, stdio: "inherit" });
console.log("Created:", zipOut);
