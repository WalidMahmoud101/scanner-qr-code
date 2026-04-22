const fs = require("fs");
const path = require("path");

/** الاسم القياسي داخل الـ ZIP و manifest (٥ أرقام). */
function qrPngBasename(slot) {
  const n = Number(slot);
  if (!Number.isFinite(n) || n < 1 || n > 99999) {
    throw new Error(`invalid slot for QR filename: ${slot}`);
  }
  return `${String(Math.trunc(n)).padStart(5, "0")}.png`;
}

/** أسماء محتملة على القرص (قديم ثلاثي أرقام، أو بدون أصفار إضافية). */
function orderedDiskBasenames(slot) {
  const n = Math.trunc(Number(slot));
  if (!Number.isFinite(n) || n < 1 || n > 99999) {
    return [];
  }
  return [
    ...new Set([
      qrPngBasename(n),
      `${String(n).padStart(3, "0")}.png`,
      `${n}.png`,
    ]),
  ];
}

/**
 * أول ملف موجود تحت qrcodes/ لهذا السلوت.
 * @returns {{ absPath: string, basenameOnDisk: string } | null}
 */
function resolveQrPngPath(qDir, slot) {
  for (const b of orderedDiskBasenames(slot)) {
    const abs = path.join(qDir, b);
    if (fs.existsSync(abs)) {
      return { absPath: abs, basenameOnDisk: b };
    }
  }
  return null;
}

module.exports = { qrPngBasename, orderedDiskBasenames, resolveQrPngPath };
