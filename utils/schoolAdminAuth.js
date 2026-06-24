import jwt from "jsonwebtoken";
import crypto from "crypto";

export const SCHOOL_ADMIN_ROLE = "school_admin";

export const SCHOOL_ADMIN_ACCESS_COOKIE = "schoolAdminAccessToken";
export const SCHOOL_ADMIN_REFRESH_COOKIE = "schoolAdminRefreshToken";
export const SCHOOL_ADMIN_CSRF_COOKIE = "schoolAdminCsrfToken";

const JWT_ALGORITHM = "HS256";
const getJwtOptions = (expiresIn) => ({
  algorithm: JWT_ALGORITHM,
  issuer: process.env.JWT_ISSUER || "myunivote-api",
  audience: process.env.JWT_AUDIENCE || "myunivote-clients",
  expiresIn,
  jwtid: crypto.randomUUID(),
});

export const signSchoolAdminAccessToken = (schoolAdmin) =>
  jwt.sign(
    {
      schoolAdminId: schoolAdmin._id,
      schoolId: schoolAdmin.schoolId,
      role: SCHOOL_ADMIN_ROLE,
      type: "access",
      sessionVersion: Number(schoolAdmin.sessionVersion || 0),
    },
    process.env.JWT_SECRET,
    getJwtOptions(process.env.JWT_SCHOOL_ADMIN_EXPIRATION || "2h")
  );

export const signSchoolAdminRefreshToken = (schoolAdmin) =>
  jwt.sign(
    {
      schoolAdminId: schoolAdmin._id,
      schoolId: schoolAdmin.schoolId,
      role: SCHOOL_ADMIN_ROLE,
      type: "refresh",
      sessionVersion: Number(schoolAdmin.sessionVersion || 0),
    },
    process.env.JWT_SECRET,
    getJwtOptions(process.env.JWT_SCHOOL_ADMIN_REFRESH_EXPIRATION || "7d")
  );

export const verifySchoolAdminToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: [JWT_ALGORITHM],
    issuer: process.env.JWT_ISSUER || "myunivote-api",
    audience: process.env.JWT_AUDIENCE || "myunivote-clients",
  });

export const createSchoolAdminCsrfToken = () =>
  crypto.randomBytes(32).toString("base64url");

export const parseCookies = (cookieHeader = "") =>
  String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) return acc;
      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (key) {
        try {
          acc[key] = decodeURIComponent(value);
        } catch {
          acc[key] = value;
        }
      }
      return acc;
    }, {});

export const getCookieOptions = ({ maxAgeMs } = {}) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  path: "/",
  ...(process.env.SCHOOL_ADMIN_COOKIE_DOMAIN
    ? { domain: process.env.SCHOOL_ADMIN_COOKIE_DOMAIN }
    : {}),
  ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
});

export const getCsrfCookieOptions = ({ maxAgeMs } = {}) => ({
  ...getCookieOptions({ maxAgeMs }),
  httpOnly: false,
});

export const getSchoolAdminAccessTokenFromRequest = (req) => {
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  return parseCookies(req.headers.cookie)[SCHOOL_ADMIN_ACCESS_COOKIE] || "";
};

export const getSchoolAdminRefreshTokenFromRequest = (req) => {
  const bodyRefreshToken = req.body?.refreshToken;
  if (bodyRefreshToken) {
    return String(bodyRefreshToken).trim();
  }

  return parseCookies(req.headers.cookie)[SCHOOL_ADMIN_REFRESH_COOKIE] || "";
};
