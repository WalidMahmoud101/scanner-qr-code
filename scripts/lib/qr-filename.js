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

/** تفضيل أقرب اسم للصورة القياسية (لما يوجد أكثر من ملف لنفس الرقم). */
function basenameScore(slot, basename) {
  const want = qrPngBasename(slot);
  if (String(basename).toLowerCase() === want.toLowerCase()) {
    return 1000;
  }
  return String(basename).length;
}

/**
 * يفهرس كل ملفات *.png تحت qDir: رقم السلوت ← مسار الملف.
 * يقبل أي عدد من الأصفار البادئة قبل الرقم (مثلاً 05105 أو 005105 إن وُجد).
 */
function buildSlotPngIndex(qDir) {
  const slotTo = new Map();
  let entries;
  try {
    entries = fs.readdirSync(qDir);
  } catch {
    return slotTo;
  }
  for (const f of entries) {
    if (!/\.png$/i.test(f)) {
      continue;
    }
    const m = f.match(/^0*(\d+)\.png$/i);
    if (!m) {
      continue;
    }
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 99999) {
      continue;
    }
    const abs = path.join(qDir, f);
    const prev = slotTo.get(n);
    if (!prev || basenameScore(n, f) > basenameScore(n, prev.basenameOnDisk)) {
      slotTo.set(n, { absPath: abs, basenameOnDisk: f });
    }
  }
  return slotTo;
}

let _indexCacheKey = "";
let _indexCacheMap = /** @type {Map<number, { absPath: string, basenameOnDisk: string }>} */ (
  new Map()
);

function getSlotPngIndex(qDir) {
  let st;
  try {
    st = fs.statSync(qDir);
  } catch {
    return new Map();
  }
  const key = `${path.resolve(qDir)}\0${st.mtimeMs}`;
  if (key === _indexCacheKey) {
    return _indexCacheMap;
  }
  _indexCacheKey = key;
  _indexCacheMap = buildSlotPngIndex(qDir);
  return _indexCacheMap;
}

/**
 * أول ملف موجود تحت qDir لهذا السلوت (أسماء شائعة ثم فحص كامل للمجلد).
 * @returns {{ absPath: string, basenameOnDisk: string } | null}
 */
function resolveQrPngPath(qDir, slot) {
  const n = Math.trunc(Number(slot));
  if (!Number.isFinite(n) || n < 1 || n > 99999) {
    return null;
  }
  for (const b of orderedDiskBasenames(n)) {
    const abs = path.join(qDir, b);
    if (fs.existsSync(abs)) {
      return { absPath: abs, basenameOnDisk: b };
    }
  }
  const hit = getSlotPngIndex(qDir).get(n);
  return hit || null;
}

/** لاستدعاءات نادرة بعد توليد صور جديدة */
function clearQrPngIndexCache() {
  _indexCacheKey = "";
  _indexCacheMap = new Map();
}

module.exports = {
  qrPngBasename,
  orderedDiskBasenames,
  buildSlotPngIndex,
  resolveQrPngPath,
  clearQrPngIndexCache,
};
