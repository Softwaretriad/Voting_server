import jwt from "jsonwebtoken";

export const SCHOOL_ADMIN_ROLE = "school_admin";

export const SCHOOL_ADMIN_ACCESS_COOKIE = "schoolAdminAccessToken";
export const SCHOOL_ADMIN_REFRESH_COOKIE = "schoolAdminRefreshToken";

export const signSchoolAdminAccessToken = (schoolAdmin) =>
  jwt.sign(
    {
      schoolAdminId: schoolAdmin._id,
      schoolId: schoolAdmin.schoolId,
      role: SCHOOL_ADMIN_ROLE,
      type: "access",
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_SCHOOL_ADMIN_EXPIRATION || "2h" }
  );

export const signSchoolAdminRefreshToken = (schoolAdmin) =>
  jwt.sign(
    {
      schoolAdminId: schoolAdmin._id,
      schoolId: schoolAdmin.schoolId,
      role: SCHOOL_ADMIN_ROLE,
      type: "refresh",
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_SCHOOL_ADMIN_REFRESH_EXPIRATION || "7d" }
  );

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
        acc[key] = decodeURIComponent(value);
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
