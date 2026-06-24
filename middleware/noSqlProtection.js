import mongoose from "mongoose";
import { sendError } from "../utils/apiResponse.js";

const findUnsafeKey = (value, path = "", seen = new WeakSet()) => {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const unsafePath = findUnsafeKey(value[index], `${path}[${index}]`, seen);
      if (unsafePath) return unsafePath;
    }
    return null;
  }

  for (const [key, childValue] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (
      key.startsWith("$") ||
      key.includes(".") ||
      key.includes("[") ||
      key.includes("]") ||
      key.includes("\0") ||
      ["__proto__", "prototype", "constructor"].includes(key)
    ) {
      return childPath;
    }

    const unsafePath = findUnsafeKey(childValue, childPath, seen);
    if (unsafePath) return unsafePath;
  }

  return null;
};

export const rejectMongoOperatorKeys = (req, res, next) => {
  const unsafeKey =
    findUnsafeKey(req.body, "body") ||
    findUnsafeKey(req.query, "query") ||
    findUnsafeKey(req.params, "params");

  if (unsafeKey) {
    return sendError(res, 400, `Unsupported input key: ${unsafeKey}`);
  }

  if (req.body && typeof req.body === "object") {
    mongoose.sanitizeFilter(req.body);
  }
  if (req.query && typeof req.query === "object") {
    mongoose.sanitizeFilter(req.query);
  }
  if (req.params && typeof req.params === "object") {
    mongoose.sanitizeFilter(req.params);
  }

  return next();
};
