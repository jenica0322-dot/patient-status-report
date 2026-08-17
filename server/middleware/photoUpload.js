const multer = require("multer");

const MAX_FILES = 10;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB per photo

// Memory storage — photos are small enough (image, capped at 10MB) to hold in
// memory briefly before writing straight to status_record_photos.file_data,
// which avoids managing a persistent uploads directory on disk.
const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (!file.mimetype || !file.mimetype.startsWith("image/")) {
    cb(new Error("only image uploads are allowed"));
    return;
  }
  cb(null, true);
}

const photoUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILES },
  fileFilter,
});

module.exports = { photoUpload, MAX_FILES, MAX_FILE_SIZE_BYTES };
