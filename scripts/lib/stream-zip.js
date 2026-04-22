const fs = require("fs");
const archiver = require("archiver");

function safeAttachmentName(name) {
  const s = String(name).replace(/[^\w.\-]/g, "_");
  return s.length ? s : "download.zip";
}

/**
 * يبني ZIP في الذاكرة/ستريم — بدون أمر `zip` في النظام (مناسب لـ Render).
 * @param {import("http").ServerResponse} res
 * @param {string} downloadName
 * @param {{ absPath: string, entryName: string }[]} files
 */
function streamZipToResponse(res, downloadName, files) {
  for (const { absPath } of files) {
    if (!fs.existsSync(absPath)) {
      return Promise.reject(new Error(`Missing file: ${absPath}`));
    }
  }

  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });

    const fail = (err) => {
      console.error("[stream-zip]", err);
      if (!res.headersSent) {
        res.status(500).type("text/plain; charset=utf-8").send("zip build failed.");
      }
      reject(err);
    };

    archive.on("error", fail);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") {
        console.warn("[stream-zip]", err);
      }
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeAttachmentName(downloadName)}"`
    );
    res.setHeader("Cache-Control", "no-store, max-age=0");

    archive.pipe(res);

    try {
      for (const { absPath, entryName } of files) {
        archive.file(absPath, { name: entryName });
      }
    } catch (e) {
      fail(e);
      return;
    }

    archive
      .finalize()
      .then(() => resolve())
      .catch(fail);
  });
}

module.exports = { streamZipToResponse };
