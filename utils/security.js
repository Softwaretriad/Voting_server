import bcrypt from "bcryptjs";
import crypto from "crypto";

const OPAQUE_TOKEN_BYTES = 24;

export const isHashedValue = (value) =>
  typeof value === "string" && value.startsWith("$2");

export const hashSecret = async (value) => bcrypt.hash(String(value), 10);

export const compareSecret = async (plainValue, storedValue) => {
  if (!storedValue) return false;
  if (isHashedValue(storedValue)) {
    return bcrypt.compare(String(plainValue), storedValue);
  }
  return String(plainValue) === String(storedValue);
};

export const createOpaqueToken = () =>
  crypto.randomBytes(OPAQUE_TOKEN_BYTES).toString("hex");

export const normalizeEmail = (value) => value?.toLowerCase?.().trim?.() || "";

export const isFourDigitPin = (value) =>
  /^\d{4}$/.test(String(value ?? ""));

export const isStrongPassword = (value) =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(
    String(value ?? "")
  );

export const strongPasswordMessage =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special character";
