import crypto from "crypto";
import { sendError } from "../utils/apiResponse.js";
import {
  parseCookies,
  SCHOOL_ADMIN_CSRF_COOKIE,
} from "../utils/schoolAdminAuth.js";

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return (
    leftBuffer.length > 0 &&
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const isAllowedOrigin = (origin) => {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (process.env.NODE_ENV !== "production") {
    return (
      !origin ||
      allowedOrigins.includes(origin) ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
    );
  }

  return Boolean(origin && allowedOrigins.includes(origin));
};

export const requireSchoolAdminCsrf = (req, res, next) => {
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.startsWith("Bearer ")) {
    return next();
  }

  const origin = String(req.headers.origin || "").trim();
  if (!isAllowedOrigin(origin)) {
    return sendError(res, 403, "Request origin is not allowed");
  }

  const cookieToken = parseCookies(req.headers.cookie)[SCHOOL_ADMIN_CSRF_COOKIE];
  const headerToken = String(req.headers["x-csrf-token"] || "").trim();
  if (!safeEqual(cookieToken, headerToken)) {
    return sendError(res, 403, "Invalid or missing CSRF token");
  }

  return next();
};
