import jwt from "jsonwebtoken";
import School from "../models/school.js";
import SchoolAdmin from "../models/SchoolAdmin.js";
import { sendError } from "../utils/apiResponse.js";
import {
  compareSecret,
  hashSecret,
  isStrongPassword,
  isValidEmail,
  normalizeEmail,
  strongPasswordMessage,
} from "../utils/security.js";
import {
  getCookieOptions,
  getSchoolAdminRefreshTokenFromRequest,
  SCHOOL_ADMIN_ACCESS_COOKIE,
  SCHOOL_ADMIN_REFRESH_COOKIE,
  SCHOOL_ADMIN_ROLE,
  signSchoolAdminAccessToken,
  signSchoolAdminRefreshToken,
} from "../utils/schoolAdminAuth.js";

const getAccessCookieMaxAgeMs = () =>
  Number(process.env.SCHOOL_ADMIN_ACCESS_COOKIE_MAX_AGE_MS || 2 * 60 * 60 * 1000);

const getRefreshCookieMaxAgeMs = () =>
  Number(process.env.SCHOOL_ADMIN_REFRESH_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);

const sanitizeSchoolAdmin = (admin) => ({
  _id: admin._id.toString(),
  schoolId: admin.schoolId?.toString?.() || admin.schoolId,
  firstName: admin.firstName,
  lastName: admin.lastName,
  email: admin.email,
  role: SCHOOL_ADMIN_ROLE,
});

const setSchoolAdminCookies = (res, { accessToken, refreshToken }) => {
  res.cookie(
    SCHOOL_ADMIN_ACCESS_COOKIE,
    accessToken,
    getCookieOptions({ maxAgeMs: getAccessCookieMaxAgeMs() })
  );
  res.cookie(
    SCHOOL_ADMIN_REFRESH_COOKIE,
    refreshToken,
    getCookieOptions({ maxAgeMs: getRefreshCookieMaxAgeMs() })
  );
};

const clearSchoolAdminCookies = (res) => {
  res.clearCookie(SCHOOL_ADMIN_ACCESS_COOKIE, getCookieOptions());
  res.clearCookie(SCHOOL_ADMIN_REFRESH_COOKIE, getCookieOptions());
};

const issueSchoolAdminSession = async (schoolAdmin) => {
  const accessToken = signSchoolAdminAccessToken(schoolAdmin);
  const refreshToken = signSchoolAdminRefreshToken(schoolAdmin);

  schoolAdmin.refreshToken = await hashSecret(refreshToken);
  schoolAdmin.lastLoginAt = new Date();
  await schoolAdmin.save();

  const school = await School.findById(schoolAdmin.schoolId).select(
    "name fullName shortName logoUrl plan subscriptionActive subscriptionTerm subscriptionExpiresAt"
  );

  return {
    accessToken,
    refreshToken,
    role: SCHOOL_ADMIN_ROLE,
    user: sanitizeSchoolAdmin(schoolAdmin),
    school: school
      ? {
          _id: school._id.toString(),
          name: school.name,
          fullName: school.fullName || school.name,
          shortName: school.shortName || "",
          logoUrl: school.logoUrl || "",
          plan: school.plan,
          subscriptionActive: school.subscriptionActive,
          subscriptionTerm: school.subscriptionTerm,
          subscriptionExpiresAt: school.subscriptionExpiresAt?.toISOString() || null,
        }
      : null,
  };
};

export const loginSchoolAdmin = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const schoolAdmin = await SchoolAdmin.findOne({
      email: normalizeEmail(email),
      isActive: true,
    });

    const passwordMatches = schoolAdmin
      ? await schoolAdmin.matchPassword(password || "")
      : false;
    if (!passwordMatches) {
      return sendError(res, 401, "Invalid email or password");
    }

    const session = await issueSchoolAdminSession(schoolAdmin);
    setSchoolAdminCookies(res, session);

    return res.status(200).json({
      role: session.role,
      user: session.user,
      school: session.school,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to login school admin");
  }
};

export const bootstrapSchoolAdmin = async (req, res) => {
  try {
    const expectedKey = String(process.env.SCHOOL_ADMIN_BOOTSTRAP_KEY || "").trim();
    const providedKey = String(
      req.headers["x-school-admin-bootstrap-key"] || req.body?.bootstrapKey || ""
    ).trim();

    if (!expectedKey || providedKey !== expectedKey) {
      return sendError(res, 403, "Invalid school admin bootstrap key");
    }

    const { schoolId, firstName, lastName, email, password } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    if (
      !schoolId ||
      !firstName ||
      !lastName ||
      !isValidEmail(normalizedEmail) ||
      !password
    ) {
      return sendError(
        res,
        400,
        "schoolId, firstName, lastName, a valid email, and password are required"
      );
    }

    if (!isStrongPassword(password)) {
      return sendError(res, 400, strongPasswordMessage);
    }

    const school = await School.findById(schoolId).select("_id");
    if (!school) {
      return sendError(res, 404, "School not found");
    }

    const existingAdmin = await SchoolAdmin.findOne({
      $or: [{ email: normalizedEmail }, { schoolId: school._id }],
    }).select("_id email schoolId");
    if (existingAdmin?.schoolId?.toString() === school._id.toString()) {
      return sendError(res, 409, "This school already has a school admin");
    }
    if (existingAdmin) {
      return sendError(res, 409, "School admin email already exists");
    }

    const schoolAdmin = await SchoolAdmin.create({
      schoolId: school._id,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: normalizedEmail,
      password,
    });

    return res.status(201).json({
      message: "School admin created",
      user: sanitizeSchoolAdmin(schoolAdmin),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to bootstrap school admin");
  }
};

export const refreshSchoolAdminSession = async (req, res) => {
  try {
    const refreshToken = getSchoolAdminRefreshTokenFromRequest(req);
    if (!refreshToken) {
      return sendError(res, 401, "Refresh token is required");
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    if (decoded.role !== SCHOOL_ADMIN_ROLE || decoded.type !== "refresh") {
      return sendError(res, 401, "Invalid refresh token scope");
    }

    const schoolAdmin = await SchoolAdmin.findOne({
      _id: decoded.schoolAdminId,
      schoolId: decoded.schoolId,
      isActive: true,
    });

    if (
      !schoolAdmin ||
      !schoolAdmin.refreshToken ||
      !(await compareSecret(refreshToken, schoolAdmin.refreshToken))
    ) {
      return sendError(res, 401, "Invalid refresh token");
    }

    const session = await issueSchoolAdminSession(schoolAdmin);
    setSchoolAdminCookies(res, session);

    return res.status(200).json({
      role: session.role,
      user: session.user,
      school: session.school,
    });
  } catch (error) {
    return sendError(res, 401, error.message || "Invalid or expired refresh token");
  }
};

export const logoutSchoolAdmin = async (req, res) => {
  try {
    const refreshToken = getSchoolAdminRefreshTokenFromRequest(req);
    if (refreshToken) {
      try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
        if (decoded.role === SCHOOL_ADMIN_ROLE) {
          await SchoolAdmin.updateOne(
            { _id: decoded.schoolAdminId },
            { $set: { refreshToken: null } }
          );
        }
      } catch {
        // Cookie cleanup should still happen even if the token is stale.
      }
    }

    clearSchoolAdminCookies(res);
    return res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to logout school admin");
  }
};

export const getSchoolAdminMe = async (req, res) => {
  const school = await School.findById(req.schoolAdmin.schoolId).select(
    "name fullName shortName logoUrl plan subscriptionActive subscriptionTerm subscriptionExpiresAt"
  );

  return res.status(200).json({
    role: SCHOOL_ADMIN_ROLE,
    user: sanitizeSchoolAdmin(req.schoolAdmin),
    school: school
      ? {
          _id: school._id.toString(),
          name: school.name,
          fullName: school.fullName || school.name,
          shortName: school.shortName || "",
          logoUrl: school.logoUrl || "",
          plan: school.plan,
          subscriptionActive: school.subscriptionActive,
          subscriptionTerm: school.subscriptionTerm,
          subscriptionExpiresAt: school.subscriptionExpiresAt?.toISOString() || null,
        }
      : null,
  });
};
