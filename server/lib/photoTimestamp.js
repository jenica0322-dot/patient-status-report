const sharp = require("sharp");

// Burns the upload date/time into the bottom-right corner of a photo so the
// timestamp travels with the image itself (download, print, screenshot) rather
// than living only in the UI. The time comes from the server clock at upload,
// not from the device or EXIF, so it can't be set by the uploader.

const TIME_ZONE = "Asia/Tokyo";

// 'YYYY/MM/DD HH:mm' in Japan time, regardless of the server's own zone.
function formatTimestamp(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function buildLabelSvg(text, imageWidth, imageHeight) {
  // Scale with the shorter side so the label reads the same on portrait and
  // landscape shots, with a floor so tiny images stay legible.
  const fontSize = Math.max(14, Math.round(Math.min(imageWidth, imageHeight) * 0.045));
  const padX = Math.round(fontSize * 0.5);
  const padY = Math.round(fontSize * 0.3);
  const margin = Math.round(fontSize * 0.5);
  // Monospace digits: ~0.62em per character is a safe width estimate.
  const boxWidth = Math.min(imageWidth, Math.round(text.length * fontSize * 0.62) + padX * 2);
  const boxHeight = Math.min(imageHeight, fontSize + padY * 2);
  const x = Math.max(0, imageWidth - boxWidth - margin);
  const y = Math.max(0, imageHeight - boxHeight - margin);

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}">
      <rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="${Math.round(fontSize * 0.2)}"
            fill="#000" fill-opacity="0.55"/>
      <text x="${x + boxWidth / 2}" y="${y + boxHeight / 2}" text-anchor="middle" dominant-baseline="central"
            font-family="Consolas, 'DejaVu Sans Mono', 'Courier New', monospace" font-weight="bold"
            font-size="${fontSize}" fill="#fff">${text}</text>
    </svg>`
  );
}

// Returns { buffer, mimetype } for the stamped photo, always as JPEG so every
// stored photo has a single predictable format.
async function stampPhoto(inputBuffer, date = new Date()) {
  // Apply EXIF orientation first so the label lands in the bottom-right of the
  // image as it is actually viewed, not of the raw sensor frame.
  const { data: upright, info } = await sharp(inputBuffer).rotate().toBuffer({ resolveWithObject: true });

  const buffer = await sharp(upright)
    .composite([{ input: buildLabelSvg(formatTimestamp(date), info.width, info.height), top: 0, left: 0 }])
    .flatten({ background: "#ffffff" }) // transparent PNGs would otherwise turn black as JPEG
    .jpeg({ quality: 90 })
    .toBuffer();

  return { buffer, mimetype: "image/jpeg" };
}

module.exports = { stampPhoto, formatTimestamp };
