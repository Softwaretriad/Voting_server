import crypto from "crypto";
import jwt from "jsonwebtoken";

export const SUPER_ADMIN_ROLE = "super_admin";

const JWT_ALGORITHM = "HS256";
const getJwtOptions = (expiresIn) => ({
  algorithm: JWT_ALGORITHM,
  issuer: process.env.JWT_ISSUER || "myunivote-api",
  audience: process.env.JWT_AUDIENCE || "myunivote-clients",
  expiresIn,
  jwtid: crypto.randomUUID(),
});

export const signSuperAdminAccessToken = (superAdmin) =>
  jwt.sign(
    {
      superAdminId: superAdmin._id,
      role: SUPER_ADMIN_ROLE,
      type: "access",
      sessionVersion: Number(superAdmin.sessionVersion || 0),
    },
    process.env.JWT_SECRET,
    getJwtOptions(process.env.JWT_SUPER_ADMIN_EXPIRATION || "2h")
  );

export const signSuperAdminRefreshToken = (superAdmin) =>
  jwt.sign(
    {
      superAdminId: superAdmin._id,
      role: SUPER_ADMIN_ROLE,
      type: "refresh",
      sessionVersion: Number(superAdmin.sessionVersion || 0),
    },
    process.env.JWT_SECRET,
    getJwtOptions(process.env.JWT_SUPER_ADMIN_REFRESH_EXPIRATION || "7d")
  );

export const verifySuperAdminToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: [JWT_ALGORITHM],
    issuer: process.env.JWT_ISSUER || "myunivote-api",
    audience: process.env.JWT_AUDIENCE || "myunivote-clients",
  });

export const getSuperAdminAccessTokenFromRequest = (req) => {
  const authHeader = String(req.headers.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    return "";
  }

  return authHeader.slice("Bearer ".length).trim();
};

export const getSuperAdminRefreshTokenFromRequest = (req) =>
  String(req.body?.refreshToken || "").trim();
