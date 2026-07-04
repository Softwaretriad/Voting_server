import multer from "multer";
import { sendError } from "../utils/apiResponse.js";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxDocumentBytes =
  Number(process.env.SCHOOL_DOCUMENT_MAX_BYTES) || 10 * 1024 * 1024;
const maxDocumentCount = Number(process.env.SCHOOL_DOCUMENT_MAX_COUNT) || 5;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxDocumentBytes,
    files: maxDocumentCount,
    fields: 1,
    parts: maxDocumentCount + 1,
    fieldNameSize: 100,
    fieldSize: 2 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Official documents must be JPEG, PNG, or WEBP images"));
      return;
    }
    callback(null, true);
  },
}).array("officialDocuments", maxDocumentCount);

export const uploadSchoolDocuments = (req, res, next) => {
  upload(req, res, (error) => {
    if (!error) {
      next();
      return;
    }

    if (error.code === "LIMIT_FILE_SIZE") {
      const maxMb = Math.ceil(maxDocumentBytes / (1024 * 1024));
      sendError(res, 400, `Each official document must be ${maxMb}MB or smaller`);
      return;
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      sendError(res, 400, `A maximum of ${maxDocumentCount} official documents is allowed`);
      return;
    }

    sendError(res, 400, error.message || "Invalid official document upload");
  });
};

export const parseSchoolRegistrationPayload = (req, res, next) => {
  if (!req.is("multipart/form-data")) {
    next();
    return;
  }

  try {
    const payload = JSON.parse(String(req.body?.payload || ""));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("payload must be a JSON object");
    }
    req.body = payload;
    next();
  } catch (error) {
    sendError(
      res,
      400,
      error.message === "payload must be a JSON object"
        ? error.message
        : "multipart school registration requires a valid JSON payload field"
    );
  }
};

