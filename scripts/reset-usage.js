const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const Database = require("better-sqlite3");

const ROOT = path.join(__dirname, "..");
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const dbPath = path.join(dataDir, "app.db");
const db = new Database(dbPath);
const n = db.prepare("UPDATE codes SET used = 0, used_at = NULL").run().changes;
const total = db.prepare("SELECT COUNT(*) AS c FROM codes").get().c;
db.close();
console.log(`Reset ${n} codes (table has ${total} rows). All are unused now.`);
