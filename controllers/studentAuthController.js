import School from "../models/school.js";
import SchoolStudentRecord from "../models/SchoolStudentRecord.js";
import Student from "../models/Student.js";
import { sendError, sanitizeStudent } from "../utils/apiResponse.js";
import { emailMatchesAllowedDomains } from "../utils/emailDomains.js";
import { resolveLogoUrl } from "../utils/logoUrl.js";
import {
  signEcAccessToken,
  signEcRefreshToken,
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from "../utils/studentAuth.js";
import {
  compareSecret,
  hashSecret,
  normalizeEmail,
} from "../utils/security.js";
import { recordActivity } from "../utils/activityLog.js";
import { EC_ROLE, ecRoleQuery, isEcAccountRole, isEcRole } from "../utils/ecRole.js";
import { verifyGoogleIdToken } from "../utils/googleAuth.js";

const getEcFirstName = (account) => account?.firstName || account?.firstname || "";

const getEcLastName = (account) => account?.lastName || "";

const getEcDisplayName = (account) =>
  [getEcFirstName(account), getEcLastName(account)].filter(Boolean).join(" ").trim();

const sanitizeEcUser = (ecUser) => ({
  id: ecUser._id,
  firstName: getEcFirstName(ecUser),
  lastName: getEcLastName(ecUser),
  name: getEcDisplayName(ecUser),
  email: ecUser.email,
  schoolId: ecUser.schoolId,
  hasVotingPin: Boolean(ecUser.votingPin),
});

const findApprovedSchoolForEmail = async (email) => {
  const schools = await School.find({
    $and: [
      { allowedEmailDomains: { $exists: true, $ne: [] } },
      {
        $or: [
          { registrationStatus: "approved" },
          { registrationStatus: { $exists: false } },
        ],
      },
    ],
  }).select("allowedEmailDomains");

  return schools.find((school) =>
    emailMatchesAllowedDomains(email, school.allowedEmailDomains)
  );
};

const issueRoleAwareSession = async (req, student, actionPrefix) => {
  if (isEcAccountRole(student.accountRole)) {
    if (student.accountRole !== EC_ROLE) {
      student.accountRole = EC_ROLE;
    }
    const session = await issueEcSession(student);
    await recordActivity({
      actorType: EC_ROLE,
      actorId: student._id,
      schoolId: student.schoolId,
      action: `${actionPrefix} EC Login Success`,
    });
    return {
      statusCode: 200,
      body: session,
    };
  }

  const session = await issueSession(req, student);
  await recordActivity({
    actorType: "student",
    actorId: student._id,
    schoolId: student.schoolId,
    action: `${actionPrefix} Student Login Success`,
  });
  return {
    statusCode: 200,
    body: {
      ...session,
      role: "student",
    },
  };
};

const findEcPrincipalById = async (userId, sessionVersion = null) => {
  const filter = {
    _id: userId,
    accountRole: ecRoleQuery(),
  };
  if (sessionVersion != null) {
    filter.sessionVersion = sessionVersion;
  }
  return Student.findOne(filter);
};

const issueSession = async (req, student) => {
  const accessToken = signAccessToken(student);
  const refreshToken = signRefreshToken(student);
  const school = student.schoolId
    ? await School.findById(student.schoolId).select("logoUrl")
    : null;

  student.refreshToken = await hashSecret(refreshToken);
  await student.save();

  return {
    accessToken,
    refreshToken,
    user: sanitizeStudent(student, {
      universityLogoUrl: resolveLogoUrl(req, school?.logoUrl),
    }),
    schoolId: student.schoolId,
    role: "student",
    hasVotingPin: Boolean(student.votingPin),
  };
};

const issueEcSession = async (ecUser) => {
  const accessToken = signEcAccessToken(ecUser);
  const refreshToken = signEcRefreshToken(ecUser);

  ecUser.refreshToken = await hashSecret(refreshToken);
  await ecUser.save();

  return {
    token: accessToken,
    refreshToken,
    accessToken,
    role: EC_ROLE,
    user: sanitizeEcUser(ecUser),
    hasVotingPin: Boolean(ecUser.votingPin),
  };
};

export const loginWithGoogle = async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) {
      return sendError(res, 400, "idToken is required");
    }

    const googleProfile = await verifyGoogleIdToken(idToken);
    const normalizedEmail = normalizeEmail(googleProfile.email);

    const googleLinkedStudent = await Student.findOne({ googleSub: googleProfile.sub });
    if (
      googleLinkedStudent &&
      normalizeEmail(googleLinkedStudent.email) !== normalizedEmail
    ) {
      return sendError(res, 409, "This Google account is already linked to another student");
    }

    let student = googleLinkedStudent || (await Student.findOne({ email: normalizedEmail }));
    if (student?.googleSub && student.googleSub !== googleProfile.sub) {
      return sendError(res, 409, "This student account is already linked to another Google account");
    }

    if (!student) {
      const school = await findApprovedSchoolForEmail(normalizedEmail);
      if (!school) {
        return sendError(res, 403, "Email does not match an approved school domain");
      }

      const importedRecord = await SchoolStudentRecord.findOne({
        schoolId: school._id,
        email: normalizedEmail,
      });
      if (!importedRecord) {
        return sendError(res, 403, "Student record has not been imported by this school");
      }
      if (
        !["male", "female"].includes(importedRecord.gender) ||
        !importedRecord.phone ||
        !importedRecord.programmeOfStudy
      ) {
        return sendError(
          res,
          409,
          "Student record is incomplete. Ask the school to re-import the complete student register."
        );
      }

      student = await Student.create({
        studentId: importedRecord.studentId,
        firstName: importedRecord.firstName || googleProfile.firstName || googleProfile.name,
        lastName: importedRecord.lastName || googleProfile.lastName || "",
        gender: importedRecord.gender,
        email: normalizedEmail,
        phone: importedRecord.phone,
        schoolId: school._id,
        universityFullName: school.fullName || school.name,
        department: importedRecord.faculty,
        currentYearOfStudy: importedRecord.currentYearOfStudy || null,
        programOfStudy: importedRecord.programmeOfStudy,
        nationality: importedRecord.nationality || "",
        votingPin: null,
        isEmailVerified: true,
        authProvider: "google",
        googleSub: googleProfile.sub,
        googleLinkedAt: new Date(),
      });
    } else {
      const currentSchool = student.schoolId
        ? await School.findById(student.schoolId).select("allowedEmailDomains")
        : null;
      const school = currentSchool || (await findApprovedSchoolForEmail(normalizedEmail));

      if (!school || !emailMatchesAllowedDomains(normalizedEmail, school.allowedEmailDomains)) {
        return sendError(res, 403, "Email does not match this student's school domain");
      }

      student.googleSub = googleProfile.sub;
      student.googleLinkedAt = student.googleLinkedAt || new Date();
      student.authProvider = "google";
      student.isEmailVerified = true;
      if (!student.schoolId || !currentSchool) {
        student.schoolId = school._id;
      }
      await student.save();
    }

    const session = await issueRoleAwareSession(req, student, "Google");
    return res.status(session.statusCode).json(session.body);
  } catch (error) {
    return sendError(
      res,
      error.statusCode || 401,
      error.message || "Failed to sign in with Google"
    );
  }
};

export const logoutStudent = async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    const authHeader = req.headers.authorization;

    if (!refreshToken) {
      return sendError(res, 400, "refreshToken is required");
    }

    if (!authHeader?.startsWith("Bearer ")) {
      return sendError(res, 401, "Authorization header is required");
    }

    const accessToken = authHeader.split(" ")[1];
    const decoded = verifyToken(accessToken);

    if (isEcRole(decoded.role)) {
      if (decoded.type !== "access") {
        return sendError(res, 401, "Invalid token scope");
      }
      const admin = await findEcPrincipalById(decoded.userId, decoded.sessionVersion);
      if (!admin) {
        return sendError(res, 401, "EC user not found");
      }

      if (!admin.refreshToken || !(await compareSecret(refreshToken, admin.refreshToken))) {
        return sendError(res, 401, "Invalid refresh token");
      }

      admin.refreshToken = null;
      admin.sessionVersion = Number(admin.sessionVersion || 0) + 1;
      await admin.save();

      return res.status(200).json({});
    }

    if (decoded.type !== "access") {
      return sendError(res, 401, "Invalid token scope");
    }
    const student = await Student.findOne({
      _id: decoded.studentId,
      sessionVersion: decoded.sessionVersion,
    });

    if (!student) {
      return sendError(res, 401, "Student not found");
    }

    if (!student.refreshToken || !(await compareSecret(refreshToken, student.refreshToken))) {
      return sendError(res, 401, "Invalid refresh token");
    }

    student.refreshToken = null;
    student.sessionVersion = Number(student.sessionVersion || 0) + 1;
    await student.save();

    return res.status(200).json({});
  } catch {
    return sendError(res, 401, "Invalid or expired token");
  }
};

export const checkTokens = async (req, res) => {
  try {
    const { accessToken, refreshToken } = req.body;

    if (!accessToken || !refreshToken) {
      return sendError(res, 400, "accessToken and refreshToken are required");
    }

    try {
      const decodedAccess = verifyToken(accessToken);
      if (decodedAccess.type !== "access") {
        throw new Error("Invalid access token scope");
      }
      if (isEcRole(decodedAccess.role)) {
        const admin = await findEcPrincipalById(
          decodedAccess.userId,
          decodedAccess.sessionVersion
        );
        if (admin && admin.refreshToken && (await compareSecret(refreshToken, admin.refreshToken))) {
          return res.status(200).json({
            user: sanitizeEcUser(admin),
            role: EC_ROLE,
            hasVotingPin: Boolean(admin.votingPin),
          });
        }
      } else {
        const student = await Student.findOne({
          _id: decodedAccess.studentId,
          sessionVersion: decodedAccess.sessionVersion,
        });

        if (student && (await compareSecret(refreshToken, student.refreshToken))) {
          return res.status(200).json({
            user: sanitizeStudent(student, {
              universityLogoUrl: resolveLogoUrl(
                req,
                (await School.findById(student.schoolId).select("logoUrl"))?.logoUrl
              ),
            }),
            role: "student",
            hasVotingPin: Boolean(student.votingPin),
          });
        }
      }
    } catch {
      // Fall through to refresh flow.
    }

    const decodedRefresh = verifyToken(refreshToken);
    if (decodedRefresh.type !== "refresh") {
      return sendError(res, 401, "Invalid refresh token");
    }

    if (isEcRole(decodedRefresh.role)) {
      const admin = await findEcPrincipalById(
        decodedRefresh.userId,
        decodedRefresh.sessionVersion
      );
      if (!admin || !admin.refreshToken || !(await compareSecret(refreshToken, admin.refreshToken))) {
        return sendError(res, 401, "Invalid refresh token");
      }

      admin.sessionVersion = Number(admin.sessionVersion || 0) + 1;
      const newSession = await issueEcSession(admin);
      return res.status(200).json(newSession);
    }

    const student = await Student.findOne({
      _id: decodedRefresh.studentId,
      sessionVersion: decodedRefresh.sessionVersion,
    });
    if (!student || !(await compareSecret(refreshToken, student.refreshToken))) {
      return sendError(res, 401, "Invalid refresh token");
    }

    student.sessionVersion = Number(student.sessionVersion || 0) + 1;
    const newAccessToken = signAccessToken(student);
    const newRefreshToken = signRefreshToken(student);

    student.refreshToken = await hashSecret(newRefreshToken);
    await student.save();

    return res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: sanitizeStudent(student, {
        universityLogoUrl: resolveLogoUrl(
          req,
          (await School.findById(student.schoolId).select("logoUrl"))?.logoUrl
        ),
      }),
      hasVotingPin: Boolean(student.votingPin),
    });
  } catch {
    return sendError(res, 401, "Invalid or expired tokens");
  }
};

export const refreshSession = async (req, res) => {
  try {
    const { refreshToken } = req.body || {};

    if (!refreshToken) {
      return sendError(res, 400, "refreshToken is required");
    }

    const decodedRefresh = verifyToken(refreshToken);
    if (decodedRefresh.type !== "refresh") {
      return sendError(res, 401, "Invalid refresh token");
    }

    if (isEcRole(decodedRefresh.role)) {
      const admin = await findEcPrincipalById(
        decodedRefresh.userId,
        decodedRefresh.sessionVersion
      );
      if (!admin || !admin.refreshToken || !(await compareSecret(refreshToken, admin.refreshToken))) {
        return sendError(res, 401, "Invalid refresh token");
      }

      admin.sessionVersion = Number(admin.sessionVersion || 0) + 1;
      const newSession = await issueEcSession(admin);
      return res.status(200).json(newSession);
    }

    const student = await Student.findOne({
      _id: decodedRefresh.studentId,
      sessionVersion: decodedRefresh.sessionVersion,
    });
    if (!student || !student.refreshToken || !(await compareSecret(refreshToken, student.refreshToken))) {
      return sendError(res, 401, "Invalid refresh token");
    }

    student.sessionVersion = Number(student.sessionVersion || 0) + 1;
    const accessToken = signAccessToken(student);
    const nextRefreshToken = signRefreshToken(student);

    student.refreshToken = await hashSecret(nextRefreshToken);
    await student.save();

    return res.status(200).json({
      accessToken,
      refreshToken: nextRefreshToken,
      user: sanitizeStudent(student, {
        universityLogoUrl: resolveLogoUrl(
          req,
          (await School.findById(student.schoolId).select("logoUrl"))?.logoUrl
        ),
      }),
      schoolId: student.schoolId,
      role: "student",
      hasVotingPin: Boolean(student.votingPin),
    });
  } catch {
    return sendError(res, 401, "Invalid or expired refresh token");
  }
};
