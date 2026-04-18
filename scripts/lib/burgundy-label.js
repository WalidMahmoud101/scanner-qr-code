/**
 * Burgundy-style label card (same layout as QR-Burgundy-Labels/generate.js).
 * Used by seed.js to write PNGs under DATA_DIR/qrcodes/001.png …
 */
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
  const displayStart = Math.max(
    1,
    Number.parseInt(process.env.LABEL_DISPLAY_START || "4410", 10) || 4410
  );
  const weddingTitle = process.env.LABEL_WEDDING_TITLE || "FAISAL & TALEED WEDDING";
  const locationEn = process.env.LABEL_LOCATION_EN || "Sofitel Cairo Downtown Nile";
  return { displayStart, weddingTitle, locationEn };
}

/**
 * @param {{ url: string, slot: number, outPath: string }} opts
 */
async function writeBurgundyLabelPng(opts) {
  const { url, slot, outPath } = opts;
  const { displayStart, weddingTitle, locationEn } = readLabelEnv();
  const displayNo = displayStart + slot - 1;
  const titleSvg = escSvgText(weddingTitle);
  const locSvg = escSvgText(locationEn);

  const qrPng = await QRCode.toBuffer(url, {
    type: "png",
    width: QR_SIZE,
    margin: 2,
    color: { dark: WINE.qrDark, light: WINE.qrLight },
    errorCorrectionLevel: "M",
  });

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${HEADER_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:${WINE.header};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${WINE.headerEdge};stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="${W / 2}" y="62" text-anchor="middle" fill="#fff5f0"
    font-family="Palatino Linotype, Palatino, Book Antiqua, Georgia, Times New Roman, Times, serif"
    font-size="38" font-weight="700" letter-spacing="0.06em">${displayNo}</text>
  <line x1="56" y1="92" x2="${W - 56}" y2="92" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
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
    font-size="15.2" font-weight="500" xml:lang="ar" direction="rtl">
    <tspan x="${W / 2}" dy="34">يُستخدَم هذا الرمز لمرّةٍ واحدةٍ فقط،</tspan>
    <tspan x="${W / 2}" dy="1.55em">ومن قِبل شخصٍ واحدٍ.</tspan>
  </text>
  <text x="${W / 2}" y="112" text-anchor="middle" fill="#5c1324"
    font-family="Palatino Linotype, Palatino, Georgia, 'Times New Roman', Times, serif"
    font-size="13.5" font-weight="600" letter-spacing="0.04em">${locSvg}</text>
</svg>`;

  const headerBuf = Buffer.from(svg);
  const footerBuf = Buffer.from(footerSvg);
  const totalH = HEADER_H + QR_SIZE + FOOTER_H;

  await sharp({
    create: {
      width: W,
      height: totalH,
      channels: 3,
      background: WINE.pageBg,
    },
  })
    .composite([
      { input: await sharp(headerBuf).png().toBuffer(), top: 0, left: 0 },
      { input: qrPng, top: HEADER_H, left: 0 },
      { input: await sharp(footerBuf).png().toBuffer(), top: HEADER_H + QR_SIZE, left: 0 },
    ])
    .png()
    .toFile(outPath);
}

module.exports = { writeBurgundyLabelPng };
