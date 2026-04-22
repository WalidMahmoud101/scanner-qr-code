const fs = require("fs");
const path = require("path");

const EXTRA_FILENAME = "qr-extra-counts.json";

function intEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") {
    return fallback;
  }
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, n));
}

/** بدايات وأعداد أساسية — الإمارات أرقام أصغر منفصلة تماماً عن مصر */
function getBasePacks() {
  return {
    uaStart: intEnv("QR_UA_START", 4110, 1, 99998),
    uaBaseCount: intEnv("QR_UA_BASE_COUNT", 75, 1, 99999),
    egyStart: intEnv("QR_EGY_START", 5105, 1, 99998),
    egyBaseCount: intEnv("QR_EGY_BASE_COUNT", 95, 1, 99999),
  };
}

function maxUaExtraAllowed(base) {
  const { uaStart, uaBaseCount, egyStart } = base;
  const gap = egyStart - (uaStart + uaBaseCount);
  return Math.max(0, gap);
}

/** يضبط ملف الإضافات إذا كان طلب الإمارات يتجاوز الحد قبل مصر */
function normalizeExtraCountsOnDisk(dataDir) {
  const base = getBasePacks();
  const extras = readExtraCounts(dataDir);
  const maxUa = maxUaExtraAllowed(base);
  if (extras.uaExtra <= maxUa) {
    return;
  }
  writeExtraCounts(dataDir, { uaExtra: extras.uaExtra, egyExtra: extras.egyExtra });
}

function readExtraCounts(dataDir) {
  const filePath = path.join(dataDir, EXTRA_FILENAME);
  if (!fs.existsSync(filePath)) {
    return { uaExtra: 0, egyExtra: 0 };
  }
  try {
    const j = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const uaExtra = Math.max(0, Math.min(99999, Math.trunc(Number(j.uaExtra)) || 0));
    const egyExtra = Math.max(0, Math.min(99999, Math.trunc(Number(j.egyExtra)) || 0));
    return { uaExtra, egyExtra };
  } catch {
    return { uaExtra: 0, egyExtra: 0 };
  }
}

/**
 * يكتب الأعداد الإضافية مع تقييد الإمارات حتى لا تلمس نطاق مصر.
 * @returns {{ uaExtra: number, egyExtra: number, clampedUa: boolean }}
 */
function writeExtraCounts(dataDir, body) {
  const base = getBasePacks();
  let uaExtra = Math.max(0, Math.min(99999, Math.trunc(Number(body.uaExtra)) || 0));
  let egyExtra = Math.max(0, Math.min(99999, Math.trunc(Number(body.egyExtra)) || 0));
  const maxUa = maxUaExtraAllowed(base);
  let clampedUa = false;
  if (uaExtra > maxUa) {
    uaExtra = maxUa;
    clampedUa = true;
  }
  fs.mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(dataDir, EXTRA_FILENAME);
  fs.writeFileSync(
    filePath,
    JSON.stringify({ uaExtra, egyExtra }, null, 2),
    "utf8"
  );
  return { uaExtra, egyExtra, clampedUa };
}

function assertNonOverlapping(p) {
  if (p.uaEnd >= p.egyStart) {
    const err = new Error(
      `overlap: UAE ends at ${p.uaEnd} but EGY starts at ${p.egyStart}. Reduce UAE extra or change QR_UA_* / QR_EGY_* in env.`
    );
    err.code = "QR_RANGE_OVERLAP";
    throw err;
  }
}

/**
 * نطاقات فعّالة للـ ZIP و seed (عند عدم ضبط SEED_SLOT_RANGES).
 */
function getPackRanges(dataDir) {
  const base = getBasePacks();
  const { uaExtra, egyExtra } = readExtraCounts(dataDir);
  const maxUa = maxUaExtraAllowed(base);
  const uaEx = Math.min(uaExtra, maxUa);
  const uaCount = base.uaBaseCount + uaEx;
  const egyCount = base.egyBaseCount + egyExtra;
  const uaEnd = base.uaStart + uaCount - 1;
  const egyEnd = base.egyStart + egyCount - 1;
  const p = {
    ...base,
    uaExtra: uaEx,
    egyExtra,
    uaExtraRaw: uaExtra,
    uaExtraClamped: uaExtra > maxUa,
    uaCount,
    egyCount,
    uaEnd,
    egyEnd,
    seedSlotRangesString: `${base.uaStart}:${uaCount},${base.egyStart}:${egyCount}`,
    zipUa: {
      start: base.uaStart,
      count: uaCount,
      downloadName: `qrcodes-UA-AE-${uaCount}-from-${base.uaStart}.zip`,
    },
    zipEgy: {
      start: base.egyStart,
      count: egyCount,
      downloadName: `qrcodes-EGY-${egyCount}-from-${base.egyStart}.zip`,
    },
  };
  assertNonOverlapping(p);
  return p;
}

function expectedSlotsFromPacks(dataDir) {
  const p = getPackRanges(dataDir);
  const slots = [];
  for (let i = 0; i < p.uaCount; i++) {
    slots.push(p.uaStart + i);
  }
  for (let i = 0; i < p.egyCount; i++) {
    slots.push(p.egyStart + i);
  }
  slots.sort((a, b) => a - b);
  return slots;
}

module.exports = {
  EXTRA_FILENAME,
  getBasePacks,
  readExtraCounts,
  normalizeExtraCountsOnDisk,
  writeExtraCounts,
  getPackRanges,
  assertNonOverlapping,
  expectedSlotsFromPacks,
  maxUaExtraAllowed,
};
