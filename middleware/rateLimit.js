import { sendError } from "../utils/apiResponse.js";
import { getRedisClient } from "../utils/redisClient.js";

const bucket = new Map();
const cleanupMemoryBucket = (now) => {
  if (bucket.size < 1000) {
    return;
  }

  for (const [bucketKey, current] of bucket.entries()) {
    if (current.resetAt <= now) {
      bucket.delete(bucketKey);
    }
  }
};

const getRequestIdentity = (req) =>
  req.user?.id ||
  req.student?._id?.toString?.() ||
  req.ecUser?._id?.toString?.() ||
  req.ip ||
  "unknown";

const hitRedisLimit = async ({ bucketKey, windowMs, max }) => {
  const client = await getRedisClient();
  if (!client) {
    return null;
  }

  const count = await client.incr(bucketKey);
  if (count === 1) {
    await client.pExpire(bucketKey, windowMs);
  }

  const ttlMs = await client.pTTL(bucketKey);
  return {
    limited: count > max,
    count,
    resetMs: ttlMs > 0 ? ttlMs : windowMs,
  };
};

export const createRateLimiter = ({
  key,
  windowMs,
  max,
  message = "Too many requests. Please try again later.",
}) => {
  return async (req, res, next) => {
    const now = Date.now();
    const bucketKey = `rate-limit:${key}:${getRequestIdentity(req)}`;

    try {
      const redisResult = await hitRedisLimit({ bucketKey, windowMs, max });
      if (redisResult) {
        if (redisResult.limited) {
          res.set("Retry-After", String(Math.ceil(redisResult.resetMs / 1000)));
          return sendError(res, 429, message);
        }
        return next();
      }
    } catch (error) {
      console.warn("Redis rate limiter failed, falling back to memory:", error.message);
    }

    cleanupMemoryBucket(now);
    const current = bucket.get(bucketKey);

    if (!current || current.resetAt <= now) {
      bucket.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= max) {
      res.set("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
      return sendError(res, 429, message);
    }

    current.count += 1;
    bucket.set(bucketKey, current);
    return next();
  };
};
