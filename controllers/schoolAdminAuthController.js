import School from "../models/school.js";
import SchoolAdmin from "../models/SchoolAdmin.js";
import SchoolStudentRecord from "../models/SchoolStudentRecord.js";
import Student from "../models/Student.js";
import StudentRegisterImport from "../models/StudentRegisterImport.js";
import { sendError } from "../utils/apiResponse.js";
import { ecRoleQuery } from "../utils/ecRole.js";
import { resolveLogoUrl } from "../utils/logoUrl.js";
import {
  getPlanConfig,
  getSubscriptionTermConfig,
  syncSchoolSubscriptionState,
} from "../utils/plans.js";
import {
  compareSecret,
  hashSecret,
  normalizeEmail,
} from "../utils/security.js";
import {
  createSchoolAdminCsrfToken,
  getCsrfCookieOptions,
  getCookieOptions,
  getSchoolAdminRefreshTokenFromRequest,
  SCHOOL_ADMIN_ACCESS_COOKIE,
  SCHOOL_ADMIN_CSRF_COOKIE,
  SCHOOL_ADMIN_REFRESH_COOKIE,
  SCHOOL_ADMIN_ROLE,
  signSchoolAdminAccessToken,
  signSchoolAdminRefreshToken,
  verifySchoolAdminToken,
} from "../utils/schoolAdminAuth.js";

const getAccessCookieMaxAgeMs = () =>
  Number(process.env.SCHOOL_ADMIN_ACCESS_COOKIE_MAX_AGE_MS || 2 * 60 * 60 * 1000);

const getRefreshCookieMaxAgeMs = () =>
  Number(process.env.SCHOOL_ADMIN_REFRESH_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);

const sanitizeSchoolAdmin = (admin) => ({
  _id: admin._id.toString(),
  id: admin._id.toString(),
  schoolId: admin.schoolId?.toString?.() || admin.schoolId,
  firstName: admin.firstName,
  lastName: admin.lastName,
  email: admin.email,
  accountRole: SCHOOL_ADMIN_ROLE,
  role: SCHOOL_ADMIN_ROLE,
});

const formatSchoolSession = (req, school) =>
  school
    ? {
        _id: school._id.toString(),
        schoolId: school._id.toString(),
        name: school.name,
        fullName: school.fullName || school.name,
        shortName: school.shortName || "",
        supportEmail: school.email || "",
        email: school.email || "",
        logoUrl: req ? resolveLogoUrl(req, school.logoUrl) : school.logoUrl || "",
        plan: school.plan,
        subscriptionActive: school.subscriptionActive,
        subscriptionTerm: school.subscriptionTerm,
        subscriptionExpiresAt: school.subscriptionExpiresAt?.toISOString() || null,
      }
    : null;

const buildSchoolAdminBootstrap = async (req, schoolAdmin) => {
  const schoolId = schoolAdmin.schoolId;
  const [school, latestImport, currentPopulation, facultyCoverage, ecMembers] =
    await Promise.all([
      School.findById(schoolId),
      StudentRegisterImport.findOne({ schoolId }).sort({ createdAt: -1 }),
      Student.countDocuments({ schoolId }),
      SchoolStudentRecord.distinct("faculty", { schoolId }).then(
        (faculties) => faculties.filter(Boolean).length
      ),
      Student.find({ schoolId, accountRole: ecRoleQuery() })
        .select("studentId firstName lastName email department nationality accountRole ecAssignedAt")
        .sort({ ecAssignedAt: -1, lastName: 1, firstName: 1 }),
    ]);

  if (!school) {
    return null;
  }

  syncSchoolSubscriptionState(school);
  const selectedPlan = getPlanConfig(school.plan);
  const selectedTerm = getSubscriptionTermConfig(school.subscriptionTerm);
  const faculties = (school.faculties || []).map((faculty) => ({
    _id: faculty._id.toString(),
    facultyId: faculty._id.toString(),
    name: faculty.name,
    programmes: (faculty.programmes || []).map((programme) => ({
      _id: programme._id.toString(),
      programmeId: programme._id.toString(),
      name: programme.name,
      durationYears: programme.durationYears ?? 4,
    })),
  }));

  return {
    schoolId: school._id.toString(),
    schoolAdmin: sanitizeSchoolAdmin(schoolAdmin),
    school: {
      _id: school._id.toString(),
      schoolId: school._id.toString(),
      name: school.name,
      fullName: school.fullName || school.name,
      shortName: school.shortName || "",
      supportEmail: school.email || "",
      email: school.email || "",
      logoUrl: resolveLogoUrl(req, school.logoUrl),
      logoStatus: school.logoUrl ? "Uploaded and active" : "Not uploaded",
      allowedEmailDomains: school.allowedEmailDomains || [],
      approvedEmailPatterns: (school.allowedEmailDomains || []).map(
        (domain) => `@${domain}`
      ),
      faculties,
      registrationStatus: school.registrationStatus || "approved",
    },
    subscription: {
      plan: school.plan,
      planName: selectedPlan.name,
      studentRange: selectedPlan.studentRange,
      voteLimit: selectedPlan.maxVoters,
      expiryDate: school.subscriptionExpiresAt?.toISOString() || null,
      isActive: school.subscriptionActive,
      subscriptionTerm: school.subscriptionTerm,
      subscriptionTermLabel: selectedTerm.label,
      currentPopulation,
    },
    latestRegisterUpload: latestImport
      ? {
          importId: latestImport._id.toString(),
          fileName: latestImport.fileName,
          uploadedAt: latestImport.createdAt.toISOString(),
          studentCount: currentPopulation,
          facultyCoverage,
          rowsProcessed: latestImport.rowsProcessed,
          rowsImported: latestImport.rowsImported,
          studentAccountsUpserted:
            latestImport.studentAccountsUpserted || latestImport.rowsImported,
          rowsSkipped: latestImport.rowsSkipped,
        }
      : null,
    ecMembers: {
      maxEcMembersPerSchool: 5,
      totalEcMembers: ecMembers.length,
      assignedEcMembers: ecMembers.map((student) => ({
        id: student._id.toString(),
        _id: student._id.toString(),
        studentId: student.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        name: `${student.firstName || ""} ${student.lastName || ""}`.trim(),
        email: student.email,
        faculty: student.department || "",
        nationality: student.nationality || "",
        accountRole: student.accountRole,
        ecAssignedAt: student.ecAssignedAt?.toISOString?.() || null,
      })),
    },
  };
};

const setSchoolAdminCookies = (res, { accessToken, refreshToken, csrfToken }) => {
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
  res.cookie(
    SCHOOL_ADMIN_CSRF_COOKIE,
    csrfToken,
    getCsrfCookieOptions({ maxAgeMs: getRefreshCookieMaxAgeMs() })
  );
};

const clearSchoolAdminCookies = (res) => {
  res.clearCookie(SCHOOL_ADMIN_ACCESS_COOKIE, getCookieOptions());
  res.clearCookie(SCHOOL_ADMIN_REFRESH_COOKIE, getCookieOptions());
  res.clearCookie(SCHOOL_ADMIN_CSRF_COOKIE, getCsrfCookieOptions());
};

const issueSchoolAdminSession = async (schoolAdmin) => {
  const accessToken = signSchoolAdminAccessToken(schoolAdmin);
  const refreshToken = signSchoolAdminRefreshToken(schoolAdmin);
  const csrfToken = createSchoolAdminCsrfToken();

  schoolAdmin.refreshToken = await hashSecret(refreshToken);
  schoolAdmin.lastLoginAt = new Date();
  await schoolAdmin.save();

  const school = await School.findById(schoolAdmin.schoolId).select(
    "name fullName shortName logoUrl email plan subscriptionActive subscriptionTerm subscriptionExpiresAt"
  );

  return {
    accessToken,
    refreshToken,
    csrfToken,
    role: SCHOOL_ADMIN_ROLE,
    user: sanitizeSchoolAdmin(schoolAdmin),
    school: formatSchoolSession(null, school),
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
      csrfToken: session.csrfToken,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to login school admin");
  }
};

export const refreshSchoolAdminSession = async (req, res) => {
  try {
    const refreshToken = getSchoolAdminRefreshTokenFromRequest(req);
    if (!refreshToken) {
      return sendError(res, 401, "Refresh token is required");
    }

    const decoded = verifySchoolAdminToken(refreshToken);
    if (decoded.role !== SCHOOL_ADMIN_ROLE || decoded.type !== "refresh") {
      return sendError(res, 401, "Invalid refresh token scope");
    }

    const schoolAdmin = await SchoolAdmin.findOne({
      _id: decoded.schoolAdminId,
      schoolId: decoded.schoolId,
      isActive: true,
      sessionVersion: decoded.sessionVersion,
    });

    if (
      !schoolAdmin ||
      !schoolAdmin.refreshToken ||
      !(await compareSecret(refreshToken, schoolAdmin.refreshToken))
    ) {
      return sendError(res, 401, "Invalid refresh token");
    }

    schoolAdmin.sessionVersion = Number(schoolAdmin.sessionVersion || 0) + 1;
    const session = await issueSchoolAdminSession(schoolAdmin);
    setSchoolAdminCookies(res, session);

    return res.status(200).json({
      role: session.role,
      user: session.user,
      school: session.school,
      csrfToken: session.csrfToken,
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
        const decoded = verifySchoolAdminToken(refreshToken);
        if (decoded.role === SCHOOL_ADMIN_ROLE) {
          await SchoolAdmin.updateOne(
            {
              _id: decoded.schoolAdminId,
              sessionVersion: decoded.sessionVersion,
            },
            {
              $set: { refreshToken: null },
              $inc: { sessionVersion: 1 },
            }
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
    "name fullName shortName logoUrl email plan subscriptionActive subscriptionTerm subscriptionExpiresAt"
  );

  return res.status(200).json({
    role: SCHOOL_ADMIN_ROLE,
    user: sanitizeSchoolAdmin(req.schoolAdmin),
    school: formatSchoolSession(req, school),
  });
};

export const getSchoolAdminBootstrap = async (req, res) => {
  try {
    const bootstrap = await buildSchoolAdminBootstrap(req, req.schoolAdmin);
    if (!bootstrap) {
      return sendError(res, 404, "School not found");
    }

    return res.status(200).json(bootstrap);
  } catch (error) {
    return sendError(
      res,
      500,
      error.message || "Failed to load school admin bootstrap"
    );
  }
};
