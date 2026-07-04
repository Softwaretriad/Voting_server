import multer from "multer";
import { sendError } from "../utils/apiResponse.js";

const maxBytes = Number(process.env.STUDENT_REGISTER_MAX_BYTES || 10 * 1024 * 1024);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxBytes,
    files: 1,
  },
});

export const uploadStudentRegister = (req, res, next) => {
  upload.single("registerFile")(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error.code === "LIMIT_FILE_SIZE") {
      return sendError(res, 413, `registerFile must be ${maxBytes} bytes or smaller`);
    }

    return sendError(res, 400, error.message || "Invalid register file upload");
  });
};
