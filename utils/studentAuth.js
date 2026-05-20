import jwt from "jsonwebtoken";

const ACCESS_TOKEN_EXPIRY = process.env.JWT_EXPIRATION || "1h";
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRATION || "7d";
const ADMIN_ACCESS_TOKEN_EXPIRY = process.env.JWT_ADMIN_EXPIRATION || "3h";
const ADMIN_REFRESH_TOKEN_EXPIRY =
  process.env.JWT_ADMIN_REFRESH_EXPIRATION || "7d";
const OTP_EXPIRY_MS = 10 * 60 * 1000;

export const createOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

export const getOtpExpiry = () => new Date(Date.now() + OTP_EXPIRY_MS);

export const signAccessToken = (student) =>
  jwt.sign({ studentId: student._id, role: "student" }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });

export const signRefreshToken = (student) =>
  jwt.sign(
    { studentId: student._id, type: "refresh", role: "student" },
    process.env.JWT_SECRET,
    {
      expiresIn: REFRESH_TOKEN_EXPIRY,
    }
  );

export const signAdminAccessToken = (admin) =>
  jwt.sign(
    { userId: admin._id, schoolId: admin.schoolId, role: "admin", type: "access" },
    process.env.JWT_SECRET,
    {
      expiresIn: ADMIN_ACCESS_TOKEN_EXPIRY,
    }
  );

export const signAdminRefreshToken = (admin) =>
  jwt.sign(
    { userId: admin._id, schoolId: admin.schoolId, role: "admin", type: "refresh" },
    process.env.JWT_SECRET,
    {
      expiresIn: ADMIN_REFRESH_TOKEN_EXPIRY,
    }
  );

export const signResetToken = (student) =>
  jwt.sign(
    { studentId: student._id, type: "reset", role: "student" },
    process.env.JWT_SECRET,
    {
      expiresIn: "10m",
    }
  );

export const verifyToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET);
