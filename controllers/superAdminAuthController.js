import crypto from "crypto";
import SuperAdmin from "../models/SuperAdmin.js";
import { sendError } from "../utils/apiResponse.js";
import {
  compareSecret,
  hashSecret,
  isStrongPassword,
  normalizeEmail,
  strongPasswordMessage,
} from "../utils/security.js";
import {
  getSuperAdminRefreshTokenFromRequest,
  signSuperAdminAccessToken,
  signSuperAdminRefreshToken,
  SUPER_ADMIN_ROLE,
  verifySuperAdminToken,
} from "../utils/superAdminAuth.js";

const sanitizeSuperAdmin = (superAdmin) => ({
  _id: superAdmin._id.toString(),
  firstName: superAdmin.firstName,
  lastName: superAdmin.lastName,
  email: superAdmin.email,
  role: SUPER_ADMIN_ROLE,
});

const issueSuperAdminSession = async (superAdmin) => {
  const accessToken = signSuperAdminAccessToken(superAdmin);
  const refreshToken = signSuperAdminRefreshToken(superAdmin);

  superAdmin.refreshToken = await hashSecret(refreshToken);
  superAdmin.lastLoginAt = new Date();
  await superAdmin.save();

  return {
    accessToken,
    refreshToken,
    role: SUPER_ADMIN_ROLE,
    user: sanitizeSuperAdmin(superAdmin),
  };
};

const bootstrapTokensMatch = (providedToken) => {
  const expectedToken = String(process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN || "").trim();
  const provided = String(providedToken || "").trim();
  if (!expectedToken || !provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  );
};

export const bootstrapSuperAdmin = async (req, res) => {
  try {
    const bootstrapToken = req.headers["x-super-admin-bootstrap-token"];
    if (!bootstrapTokensMatch(bootstrapToken)) {
      return sendError(res, 404, "Route not found");
    }

    const existingSuperAdmin = await SuperAdmin.findOne({}).select("_id");
    if (existingSuperAdmin) {
      return sendError(res, 409, "Super admin already exists");
    }

    const { firstName, lastName, email, password } = req.body || {};
    if (!firstName || !lastName || !email || !password) {
      return sendError(res, 400, "firstName, lastName, email, and password are required");
    }

    if (!isStrongPassword(password)) {
      return sendError(res, 400, strongPasswordMessage);
    }

    const superAdmin = await SuperAdmin.create({
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: normalizeEmail(email),
      password,
      isActive: true,
    });

    return res.status(201).json({
      message: "Super admin created",
      user: sanitizeSuperAdmin(superAdmin),
    });
  } catch (error) {
    if (error.code === 11000) {
      return sendError(res, 409, "Super admin email already exists");
    }

    return sendError(res, 500, error.message || "Failed to create super admin");
  }
};

export const loginSuperAdmin = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const superAdmin = await SuperAdmin.findOne({
      email: normalizeEmail(email),
      isActive: true,
    });

    const passwordMatches = superAdmin
      ? await superAdmin.matchPassword(password || "")
      : false;
    if (!passwordMatches) {
      return sendError(res, 401, "Invalid email or password");
    }

    const session = await issueSuperAdminSession(superAdmin);
    return res.status(200).json(session);
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to login super admin");
  }
};

export const refreshSuperAdminSession = async (req, res) => {
  try {
    const refreshToken = getSuperAdminRefreshTokenFromRequest(req);
    if (!refreshToken) {
      return sendError(res, 401, "Refresh token is required");
    }

    const decoded = verifySuperAdminToken(refreshToken);
    if (decoded.role !== SUPER_ADMIN_ROLE || decoded.type !== "refresh") {
      return sendError(res, 401, "Invalid refresh token scope");
    }

    const superAdmin = await SuperAdmin.findOne({
      _id: decoded.superAdminId,
      isActive: true,
      sessionVersion: decoded.sessionVersion,
    });

    if (
      !superAdmin ||
      !superAdmin.refreshToken ||
      !(await compareSecret(refreshToken, superAdmin.refreshToken))
    ) {
      return sendError(res, 401, "Invalid refresh token");
    }

    superAdmin.sessionVersion = Number(superAdmin.sessionVersion || 0) + 1;
    const session = await issueSuperAdminSession(superAdmin);
    return res.status(200).json(session);
  } catch (error) {
    return sendError(res, 401, error.message || "Invalid or expired refresh token");
  }
};

export const logoutSuperAdmin = async (req, res) => {
  try {
    const refreshToken = getSuperAdminRefreshTokenFromRequest(req);
    if (refreshToken) {
      try {
        const decoded = verifySuperAdminToken(refreshToken);
        if (decoded.role === SUPER_ADMIN_ROLE) {
          await SuperAdmin.updateOne(
            {
              _id: decoded.superAdminId,
              sessionVersion: decoded.sessionVersion,
            },
            {
              $set: { refreshToken: null },
              $inc: { sessionVersion: 1 },
            }
          );
        }
      } catch {
        // Logout should be idempotent for stale tokens.
      }
    }

    return res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to logout super admin");
  }
};

export const getSuperAdminMe = async (req, res) =>
  res.status(200).json({
    role: SUPER_ADMIN_ROLE,
    user: sanitizeSuperAdmin(req.superAdmin),
  });
