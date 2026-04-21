const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const Database = require("better-sqlite3");

const ROOT = path.join(__dirname, "..");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const dbPath = path.join(dataDir, "app.db");
const db = new Database(dbPath);
const colNames = new Set(db.prepare("PRAGMA table_info(codes)").all().map((c) => c.name));
if (!colNames.has("wc_away_at")) {
  db.exec("ALTER TABLE codes ADD COLUMN wc_away_at TEXT");
}
const n = db.prepare("UPDATE codes SET used = 0, used_at = NULL, wc_away_at = NULL").run().changes;
const total = db.prepare("SELECT COUNT(*) AS c FROM codes").get().c;
db.close();
console.log(`Reset ${n} codes (table has ${total} rows). All are unused now.`);
