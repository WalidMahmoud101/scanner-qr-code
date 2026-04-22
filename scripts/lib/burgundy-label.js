/**
 * Burgundy-style label card (same layout as QR-Burgundy-Labels/generate.js).
 * Used by seed.js to write PNGs under DATA_DIR/qrcodes/ (اسم الملف من qr-filename.js).
 *
 * الأرقام على الصورة:
 *   الرقم الكبير في الشريط العلوي = رقم السلوت `slot` اللي seed يمرّره لكل ملف (4110، 5105، …).
 *   ما تحتاجش تعدّل هذا الملف لكل رقم — كل صورة تتولّد لوحدها من اللوب في seed.
 *
 * اللي تغيّره لكل مناسبة (من .env مش من الكود):
 *   LABEL_WEDDING_TITLE، LABEL_LOCATION_EN، وأسطر الفوتر العربي أدناه.
 */
const fs = require("fs");
const QRCode = require("qrcode");
const sharp = require("sharp");

const W = 520;
const HEADER_H = 152;
const QR_SIZE = W;
const FOOTER_H = 132;

const WINE = {
  header: "#5c1324",
  headerEdge: "#3d0c18",
  qrDark: "#4a0f1e",
  qrLight: "#fffaf7",
  pageBg: "#f4e8e4",
};

function escSvgText(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readLabelEnv() {
  const weddingTitle = process.env.LABEL_WEDDING_TITLE || "FAISAL & TALEED'S WEDDING";
  const locationEn =
    process.env.LABEL_LOCATION_EN || "Sofitel Cairo Downtown Nile - Cairo";
  const footerArLine1 =
    process.env.LABEL_FOOTER_AR_LINE1 || "يُستخدَم هذا الرمز لمرّةٍ واحدةٍ فقط،";
  const footerArLine2 =
    process.env.LABEL_FOOTER_AR_LINE2 || "ومن قِبل شخصٍ واحدٍ.";
  return { weddingTitle, locationEn, footerArLine1, footerArLine2 };
}

/**
 * @param {{ url: string, slot: number, outPath: string }} opts
 */
async function writeBurgundyLabelPng(opts) {
  const { url, slot, outPath } = opts;
  const { weddingTitle, locationEn, footerArLine1, footerArLine2 } = readLabelEnv();
  /** الرقم الظاهر على الكارت = رقم السلوت من قاعدة البيانات (يتغيّر تلقائياً لكل PNG). */
  const displayNo = slot;
  const titleSvg = escSvgText(weddingTitle);
  const locSvg = escSvgText(locationEn);
  const ar1 = escSvgText(footerArLine1);
  const ar2 = escSvgText(footerArLine2);
  const gid = `g${slot}`;

  const qrRaw = await QRCode.toBuffer(url, {
    type: "png",
    width: QR_SIZE,
    margin: 2,
    color: { dark: WINE.qrDark, light: WINE.qrLight },
    errorCorrectionLevel: "M",
  });

  /** QR أبعاد ثابتة + RGB بدون شفافية عشان الـ composite ما يطلعش بقع بيضا على بعض السيرفرات */
  const qrRgb = await sharp(qrRaw)
    .resize(QR_SIZE, QR_SIZE)
    .flatten({ background: WINE.qrLight })
    .png()
    .toBuffer();

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${HEADER_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${gid}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:${WINE.header};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${WINE.headerEdge};stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#${gid})"/>
  <text x="${W / 2}" y="62" text-anchor="middle" fill="#fff5f0"
    font-family="Palatino Linotype, Palatino, Book Antiqua, Georgia, Times New Roman, Times, serif"
    font-size="38" font-weight="700" letter-spacing="0.06em">${displayNo}</text>
  <!-- فاصل: قوسان منحنيان (يسار / يمين) + خط مركزي خفيف -->
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 32 101 Q 52 92 32 83" stroke="rgba(255,255,255,0.42)" stroke-width="1.55"/>
    <path d="M 488 83 Q 468 92 488 101" stroke="rgba(255,255,255,0.42)" stroke-width="1.55"/>
    <line x1="86" y1="92" x2="434" y2="92" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
  </g>
  <text x="${W / 2}" y="130" text-anchor="middle" fill="#fffefb"
    font-family="Palatino Linotype, Palatino, Book Antiqua, Georgia, Times New Roman, Times, serif"
    font-size="17.5" font-weight="600" letter-spacing="0.14em">${titleSvg}</text>
</svg>`;

  const footerSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${FOOTER_H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${WINE.pageBg}"/>
  <line x1="44" y1="0" x2="${W - 44}" y2="0" stroke="#5c1324" stroke-opacity="0.22" stroke-width="1.5"/>
  <text x="${W / 2}" y="0" text-anchor="middle" fill="#3d0c18"
    font-family="Geeza Pro, Baghdad, 'Noto Naskh Arabic', 'Damascus', Tahoma, Arial, sans-serif"
    font-size="15.2" font-weight="700" xml:lang="ar" direction="rtl">
    <tspan x="${W / 2}" dy="34">${ar1}</tspan>
    <tspan x="${W / 2}" dy="1.55em">${ar2}</tspan>
  </text>
  <text x="${W / 2}" y="112" text-anchor="middle" fill="#5c1324"
    font-family="Palatino Linotype, Palatino, Georgia, 'Times New Roman', Times, serif"
    font-size="13.5" font-weight="700" letter-spacing="0.04em">${locSvg}</text>
</svg>`;

  const headerPng = await sharp(Buffer.from(svg)).png().toBuffer();
  const footerPng = await sharp(Buffer.from(footerSvg)).png().toBuffer();
  const totalH = HEADER_H + QR_SIZE + FOOTER_H;

  const tmpPath = `${outPath}.${process.pid}.tmp`;
  await sharp({
    create: {
      width: W,
      height: totalH,
      channels: 3,
      background: WINE.pageBg,
    },
  })
    .composite([
      { input: headerPng, top: 0, left: 0 },
      { input: qrRgb, top: HEADER_H, left: 0 },
      { input: footerPng, top: HEADER_H + QR_SIZE, left: 0 },
    ])
    .png()
    .toFile(tmpPath);

  const st = fs.statSync(tmpPath);
  if (st.size < 8000) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* noop */
    }
    throw new Error(`Burgundy label too small (${st.size} bytes) for slot ${slot}`);
  }

  fs.renameSync(tmpPath, outPath);
}

module.exports = { writeBurgundyLabelPng };
