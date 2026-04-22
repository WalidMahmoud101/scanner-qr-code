/** اسم ملف PNG تحت qrcodes/ (متّسق مع السيرفر و manifest). */
function qrPngBasename(slot) {
  const n = Number(slot);
  if (!Number.isFinite(n) || n < 1 || n > 99999) {
    throw new Error(`invalid slot for QR filename: ${slot}`);
  }
  return `${String(Math.trunc(n)).padStart(5, "0")}.png`;
}

module.exports = { qrPngBasename };
