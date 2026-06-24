import fs from "fs";
import crypto from "crypto";
import path from "path";
import multer from "multer";

export const uploadDirectory = path.join(
  process.cwd(),
  "public",
  "assets",
  "uploads"
);
export const uploadTempDirectory = path.join(
  process.cwd(),
  ".tmp",
  "image-uploads"
);

fs.mkdirSync(uploadDirectory, { recursive: true });
fs.mkdirSync(uploadTempDirectory, { recursive: true });

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxUploadBytes = Number(process.env.IMAGE_UPLOAD_MAX_BYTES) || 5 * 1024 * 1024;

export const sanitizeUploadKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "image";

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadTempDirectory);
  },
  filename: (_req, _file, cb) => {
    cb(null, `pending-${Date.now()}-${crypto.randomUUID()}.upload`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (!allowedMimeTypes.has(file.mimetype)) {
    cb(new Error("Only JPEG, PNG, and WEBP images are allowed"));
    return;
  }

  cb(null, true);
};

export const uploadImage = multer({
  storage,
  limits: {
    fileSize: maxUploadBytes,
    files: 1,
    fields: 10,
    parts: 11,
    fieldNameSize: 100,
    fieldSize: 16 * 1024,
  },
  fileFilter,
}).single("image");
