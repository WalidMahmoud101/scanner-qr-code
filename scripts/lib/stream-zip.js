const fs = require("fs");
const { Writable } = require("stream");
const { finished } = require("stream/promises");
const archiver = require("archiver");

const MAX_BUILD_BYTES = Number(process.env.ZIP_MAX_BYTES || 80 * 1024 * 1024);

function safeAttachmentName(name) {
  const s = String(name).replace(/[^\w.\-]/g, "_");
  return s.length ? s : "download.zip";
}

/**
 * يبني ZIP في الذاكرة ثم يرسله بـ Content-Length (أفضل مع سفاري / بروكسيات من غير chunked).
 * @param {{ absPath: string, entryName: string }[]} files
 */
async function buildZipBuffer(files) {
  let rawTotal = 0;
  for (const { absPath } of files) {
    if (!fs.existsSync(absPath)) {
      throw new Error(`Missing file: ${absPath}`);
    }
    rawTotal += fs.statSync(absPath).size;
    if (rawTotal > MAX_BUILD_BYTES) {
      throw new Error(`ZIP sources exceed limit (${MAX_BUILD_BYTES} bytes).`);
    }
  }

  const archive = archiver("zip", { zlib: { level: 6 } });
  const chunks = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });

  archive.on("warning", (err) => {
    if (err.code !== "ENOENT") {
      console.warn("[stream-zip]", err);
    }
  });

  const fail = (err) => {
    archive.abort();
    sink.destroy(err);
  };
  archive.on("error", fail);
  sink.on("error", fail);

  archive.pipe(sink);

  for (const { absPath, entryName } of files) {
    archive.file(absPath, { name: entryName });
  }

  await archive.finalize();
  await finished(sink);
  return Buffer.concat(chunks);
}

/**
 * @param {import("http").ServerResponse} res
 * @param {string} downloadName
 * @param {{ absPath: string, entryName: string }[]} files
 */
async function streamZipToResponse(res, downloadName, files) {
  const buf = await buildZipBuffer(files);
  const name = safeAttachmentName(downloadName);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.send(buf);
}

module.exports = { streamZipToResponse, buildZipBuffer };
