import { sendError } from "../utils/apiResponse.js";

const bucket = new Map();

export const createRateLimiter = ({
  key,
  windowMs,
  max,
  message = "Too many requests. Please try again later.",
}) => {
  return (req, res, next) => {
    const now = Date.now();
    const bucketKey = `${key}:${req.ip || "unknown"}`;
    const current = bucket.get(bucketKey);

    if (!current || current.resetAt <= now) {
      bucket.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= max) {
      return sendError(res, 429, message);
    }

    current.count += 1;
    bucket.set(bucketKey, current);
    return next();
  };
};
