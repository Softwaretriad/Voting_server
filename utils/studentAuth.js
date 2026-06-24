import jwt from "jsonwebtoken";
import crypto from "crypto";
import { EC_ROLE } from "./ecRole.js";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const JWT_ALGORITHM = "HS256";

const getJwtOptions = ({ expiresIn, jwtid = crypto.randomUUID() } = {}) => ({
  algorithm: JWT_ALGORITHM,
  issuer: process.env.JWT_ISSUER || "myunivote-api",
  audience: process.env.JWT_AUDIENCE || "myunivote-clients",
  expiresIn,
  jwtid,
});

export const createOtp = () =>
  crypto.randomInt(100000, 1000000).toString();

export const getOtpExpiry = () => new Date(Date.now() + OTP_EXPIRY_MS);

export const signAccessToken = (student) =>
  jwt.sign(
    {
      studentId: student._id,
      role: "student",
      type: "access",
      sessionVersion: Number(student.sessionVersion || 0),
    },
    process.env.JWT_SECRET,
    getJwtOptions({ expiresIn: process.env.JWT_EXPIRATION || "1h" })
  );

export const signRefreshToken = (student) =>
  jwt.sign(
    {
      studentId: student._id,
      type: "refresh",
      role: "student",
      sessionVersion: Number(student.sessionVersion || 0),
    },
    process.env.JWT_SECRET,
    getJwtOptions({ expiresIn: process.env.JWT_REFRESH_EXPIRATION || "7d" })
  );

export const signEcAccessToken = (ecUser) =>
  jwt.sign(
    {
      userId: ecUser._id,
      schoolId: ecUser.schoolId,
      role: EC_ROLE,
      type: "access",
      sessionVersion: Number(ecUser.sessionVersion || 0),
    },
    process.env.JWT_SECRET,
    getJwtOptions({
      expiresIn:
        process.env.JWT_EC_EXPIRATION ||
        process.env.JWT_ADMIN_EXPIRATION ||
        "8h",
    })
  );

export const signEcRefreshToken = (ecUser) =>
  jwt.sign(
    {
      userId: ecUser._id,
      schoolId: ecUser.schoolId,
      role: EC_ROLE,
      type: "refresh",
      sessionVersion: Number(ecUser.sessionVersion || 0),
    },
    process.env.JWT_SECRET,
    getJwtOptions({
      expiresIn:
        process.env.JWT_EC_REFRESH_EXPIRATION ||
        process.env.JWT_ADMIN_REFRESH_EXPIRATION ||
        "14d",
    })
  );

export const signAdminAccessToken = signEcAccessToken;
export const signAdminRefreshToken = signEcRefreshToken;

export const signResetToken = (student) =>
  jwt.sign(
    {
      studentId: student._id,
      type: "reset",
      role: "student",
      sessionVersion: Number(student.sessionVersion || 0),
    },
    process.env.JWT_SECRET,
    getJwtOptions({ expiresIn: "10m" })
  );

export const verifyToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: [JWT_ALGORITHM],
    issuer: process.env.JWT_ISSUER || "myunivote-api",
    audience: process.env.JWT_AUDIENCE || "myunivote-clients",
  });
