import fs from "fs";
import path from "path";
import multer from "multer";

export const uploadDirectory = path.join(
  process.cwd(),
  "public",
  "assets",
  "uploads"
);

fs.mkdirSync(uploadDirectory, { recursive: true });

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const sanitizeUploadKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "image";

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDirectory);
  },
  filename: (req, file, cb) => {
    const studentId = sanitizeUploadKey(req.body?.studentId);
    const clientKey = sanitizeUploadKey(req.body?.clientKey);
    const extension = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const baseName = studentId !== "image" ? studentId : clientKey;
    cb(null, `${baseName}-${Date.now()}${extension}`);
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
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter,
}).single("image");
