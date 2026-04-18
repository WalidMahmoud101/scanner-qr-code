const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "..", "data", "app.db");
const db = new Database(dbPath);
const n = db.prepare("UPDATE codes SET used = 0, used_at = NULL").run().changes;
const total = db.prepare("SELECT COUNT(*) AS c FROM codes").get().c;
db.close();
console.log(`Reset ${n} codes (table has ${total} rows). All are unused now.`);
