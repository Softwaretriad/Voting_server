import bcrypt from "bcryptjs";
import crypto from "crypto";

const OPAQUE_TOKEN_BYTES = 24;
const PIN_HASH_PREFIX = "pin$sha256$";

export const isHashedValue = (value) =>
  typeof value === "string" && value.startsWith("$2");

export const isPinHashValue = (value) =>
  typeof value === "string" && value.startsWith(PIN_HASH_PREFIX);

const getPinHashSecret = () =>
  process.env.PIN_HASH_SECRET || process.env.JWT_SECRET || "development-pin-secret";

const createPinDigest = (value) =>
  crypto
    .createHmac("sha256", getPinHashSecret())
    .update(String(value))
    .digest("hex");

export const hashSecret = async (value) => bcrypt.hash(String(value), 10);

export const hashPin = async (value) => `${PIN_HASH_PREFIX}${createPinDigest(value)}`;

export const compareSecret = async (plainValue, storedValue) => {
  if (!storedValue) return false;
  if (isHashedValue(storedValue)) {
    return bcrypt.compare(String(plainValue), storedValue);
  }
  return String(plainValue) === String(storedValue);
};

export const comparePin = async (plainValue, storedValue) => {
  if (!storedValue) return false;
  if (isPinHashValue(storedValue)) {
    const expected = createPinDigest(plainValue);
    const actual = String(storedValue).slice(PIN_HASH_PREFIX.length);
    if (actual.length !== expected.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  }

  return compareSecret(plainValue, storedValue);
};

export const createOpaqueToken = () =>
  crypto.randomBytes(OPAQUE_TOKEN_BYTES).toString("hex");

export const normalizeEmail = (value) => value?.toLowerCase?.().trim?.() || "";

export const isValidEmail = (value) => {
  const email = normalizeEmail(value);
  if (!email || email.length > 254 || /[\s\r\n]/.test(email)) {
    return false;
  }

  const atIndex = email.lastIndexOf("@");
  if (atIndex <= 0 || atIndex !== email.indexOf("@")) {
    return false;
  }

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);
  if (
    localPart.length > 64 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart) ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..")
  ) {
    return false;
  }

  return (
    domain.length <= 253 &&
    domain.includes(".") &&
    domain.split(".").every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    )
  );
};

export const isFourDigitPin = (value) =>
  /^\d{4}$/.test(String(value ?? ""));

export const isStrongPassword = (value) =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(
    String(value ?? "")
  );

export const strongPasswordMessage =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special character";
