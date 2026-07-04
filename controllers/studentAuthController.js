import School from "../models/school.js";
import SchoolStudentRecord from "../models/SchoolStudentRecord.js";
import Student from "../models/Student.js";
import sendEmail from "../utils/sendEmail.js";
import { sendError, sanitizeStudent } from "../utils/apiResponse.js";
import { emailMatchesAllowedDomains } from "../utils/emailDomains.js";
import { resolveLogoUrl } from "../utils/logoUrl.js";
import {
  createOtp,
  getOtpExpiry,
  signEcAccessToken,
  signEcRefreshToken,
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from "../utils/studentAuth.js";
import {
  compareSecret,
  createOpaqueToken,
  hashSecret,
  isFourDigitPin,
  isStrongPassword,
  normalizeEmail,
  strongPasswordMessage,
} from "../utils/security.js";
import { recordActivity } from "../utils/activityLog.js";
import {
  notifyAdmin,
  notifyStudent,
} from "../utils/notificationService.js";
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
});

const createImportedAccountPassword = () => `oauth-only-${createOpaqueToken()}`;

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

const sendVerificationOtp = async (student) => {
  const otp = createOtp();
  const expiresAt = getOtpExpiry();
  student.emailVerificationOtp = await hashSecret(otp);
  student.emailVerificationOtpExpires = expiresAt;
  await student.save();

  await sendEmail(
    student.email,
    "Verify your MyUniVote email",
    `Your MyUniVote verification code is ${otp}. It expires in 10 minutes.`
  );

  return { otp, expiresAt };
};

const getDebugOtpPayload = (req, otp, expiresAt) => {
  const wantsDebugOtp = String(req.headers["x-debug-otp"] || "").toLowerCase() === "true";
  if (process.env.NODE_ENV === "production" || !wantsDebugOtp) {
    return {};
  }

  return {
    debugOtp: otp,
    debugOtpExpiresAt: expiresAt?.toISOString?.() || null,
  };
};

const wantsDebugOtp = (req) =>
  process.env.NODE_ENV !== "production" &&
  String(req.headers["x-debug-otp"] || "").toLowerCase() === "true";

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
  };
};

const resolveSchoolSelection = async ({
  universityFullName,
  department,
  programOfStudy,
  email,
}) => {
  const school = await School.findOne({
    $and: [
      {
        $or: [{ fullName: universityFullName }, { name: universityFullName }],
      },
      {
        $or: [
          { registrationStatus: "approved" },
          { registrationStatus: { $exists: false } },
        ],
      },
    ],
  });

  if (!school) {
    return { error: "Selected university was not found in the school list" };
  }

  if (!Array.isArray(school.allowedEmailDomains) || school.allowedEmailDomains.length === 0) {
    return { error: "Selected university has no allowed email domains configured" };
  }

  if (!emailMatchesAllowedDomains(email, school.allowedEmailDomains)) {
    return {
      error: `Email must use one of this university's allowed domains: ${school.allowedEmailDomains.join(", ")}`,
    };
  }

  const faculty = school.faculties.find((item) => item.name === department);
  if (!faculty) {
    return { error: "Selected faculty was not found for this university" };
  }

  const programme = faculty.programmes.find((item) => item.name === programOfStudy);
  if (!programme) {
    return { error: "Selected programme was not found for this faculty" };
  }

  return { school };
};

export const registerStudent = async (req, res) => {
  try {
    if (process.env.MANUAL_STUDENT_REGISTRATION_ENABLED === "false") {
      return sendError(res, 403, "Manual student registration is disabled");
    }

    const {
      studentId,
      firstName,
      lastName,
      gender,
      email,
      password,
      phone,
      universityFullName,
      department,
      currentYearOfStudy,
      programOfStudy,
    } = req.body;

    const normalizedEmail = normalizeEmail(email);

    if (
      !studentId ||
      !firstName ||
      !lastName ||
      !gender ||
      !normalizedEmail ||
      !password ||
      !phone ||
      !universityFullName ||
      !department ||
      !programOfStudy
    ) {
      return sendError(res, 400, "All required registration fields must be provided");
    }

    if (!isStrongPassword(password)) {
      return sendError(res, 400, strongPasswordMessage);
    }

    if (req.body.votingPin != null && !isFourDigitPin(req.body.votingPin)) {
      return sendError(res, 400, "Voting PIN must be a 4-digit integer");
    }

    const existingStudent = await Student.findOne({ email: normalizedEmail });
    if (existingStudent) {
      return sendError(res, 409, "Email already registered");
    }

    const { school, error: schoolError } = await resolveSchoolSelection({
      universityFullName,
      department,
      programOfStudy,
      email: normalizedEmail,
    });

    if (schoolError) {
      return sendError(res, 400, schoolError);
    }

    const student = await Student.create({
      studentId,
      firstName,
      lastName,
      gender,
      email: normalizedEmail,
      password,
      phone,
      schoolId: school._id,
      universityFullName,
      department,
      currentYearOfStudy:
        currentYearOfStudy == null || currentYearOfStudy === ""
          ? null
          : Number(currentYearOfStudy),
      programOfStudy,
      votingPin: req.body.votingPin == null ? null : String(req.body.votingPin),
    });

    const { otp, expiresAt } = await sendVerificationOtp(student);
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "account_created_verification_sent",
      title: "Account created",
      message: "Your verification OTP has been sent to your email address.",
      priority: "high",
    });
    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Student Registration Initiated",
    });

    return res.status(201).json({
      email: student.email,
      ...getDebugOtpPayload(req, otp, expiresAt),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to register student");
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const student = await Student.findOne({ email: normalizeEmail(email) });
    const otpMatches = student
      ? await compareSecret(otp, student.emailVerificationOtp)
      : false;
    const expiresAt = student?.emailVerificationOtpExpires || null;
    const isExpired = expiresAt ? expiresAt < new Date() : true;

    if (
      !student ||
      !otpMatches ||
      !expiresAt ||
      isExpired
    ) {
      return sendError(
        res,
        400,
        "Invalid or expired OTP",
        wantsDebugOtp(req)
          ? {
              debug: {
                studentFound: Boolean(student),
                storedOtpExists: Boolean(student?.emailVerificationOtp),
                otpMatches,
                expiresAt: expiresAt?.toISOString?.() || null,
                isExpired,
                now: new Date().toISOString(),
                submittedOtp: String(otp || ""),
              },
            }
          : {}
      );
    }

    student.isEmailVerified = true;
    student.emailVerificationOtp = null;
    student.emailVerificationOtpExpires = null;
    await student.save();

    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Student Email Verified",
    });
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "email_verified_successfully",
      title: "Email verified",
      message: "Your email has been verified successfully.",
      priority: "normal",
    });

    const session = await issueSession(req, student);
    return res.status(200).json(session);
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to verify email");
  }
};

export const resendVerificationOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const student = await Student.findOne({ email: normalizeEmail(email) });

    if (!student || student.isEmailVerified) {
      return res.status(200).json({});
    }

    const { otp, expiresAt } = await sendVerificationOtp(student);
    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Student Verification OTP Resent",
    });
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "verification_otp_resent",
      title: "Verification code resent",
      message: "A new verification OTP has been sent to your email.",
      priority: "normal",
    });

    return res.status(200).json({
      ...getDebugOtpPayload(req, otp, expiresAt),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to resend verification OTP");
  }
};

export const loginStudent = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const student = await Student.findOne({ email: normalizedEmail });

    const studentPasswordMatches = student
      ? await student.matchPassword(password || "")
      : false;

    if (studentPasswordMatches) {
      if (!student.isEmailVerified) {
        return sendError(
          res,
          403,
          "Email not verified. Please request a new verification code."
        );
      }

      if (isEcAccountRole(student.accountRole)) {
        if (student.accountRole !== EC_ROLE) {
          student.accountRole = EC_ROLE;
        }
        const session = await issueEcSession(student);
        await recordActivity({
          actorType: EC_ROLE,
          actorId: student._id,
          schoolId: student.schoolId,
          action: "EC Login Success",
        });
        await notifyAdmin({
          ecUserId: student._id,
          schoolId: student.schoolId,
          type: "ec_login_success",
          title: "Login successful",
          message: "You signed in successfully.",
          priority: "low",
        });
        return res.status(200).json(session);
      }

      const session = await issueSession(req, student);
      await recordActivity({
        actorType: "student",
        actorId: student._id,
        schoolId: student.schoolId,
        action: "Student Login Success",
      });
      return res.status(200).json({
        ...session,
        role: "student",
      });
    }

    return sendError(res, 401, "Invalid email or password");
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to login");
  }
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
        password: createImportedAccountPassword(),
        passwordLoginEnabled: false,
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
      const school = student.schoolId
        ? await School.findById(student.schoolId).select("allowedEmailDomains")
        : await findApprovedSchoolForEmail(normalizedEmail);

      if (!school || !emailMatchesAllowedDomains(normalizedEmail, school.allowedEmailDomains)) {
        return sendError(res, 403, "Email does not match this student's school domain");
      }

      student.googleSub = googleProfile.sub;
      student.googleLinkedAt = student.googleLinkedAt || new Date();
      student.authProvider =
        student.authProvider === "password" && student.passwordLoginEnabled !== false
          ? "password"
          : "google";
      student.isEmailVerified = true;
      if (!student.schoolId) {
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
    });
  } catch {
    return sendError(res, 401, "Invalid or expired refresh token");
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const student = await Student.findOne({ email: normalizeEmail(email) });

    if (!student) {
      return res.status(200).json({});
    }

    const otp = createOtp();
    student.passwordResetOtp = await hashSecret(otp);
    student.passwordResetOtpExpires = getOtpExpiry();
    await student.save();

    await sendEmail(
      student.email,
      "Reset your MyUniVote password",
      `Your MyUniVote password reset code is ${otp}. It expires in 10 minutes.`
    );

    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Student Password Reset Requested",
    });
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "password_reset_requested",
      title: "Password reset requested",
      message: "A password reset OTP has been sent to your email.",
      priority: "high",
    });

    return res.status(200).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to send reset OTP");
  }
};

export const verifyResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const student = await Student.findOne({ email: normalizeEmail(email) });

    if (
      student &&
      student.emailVerificationOtp &&
      student.emailVerificationOtpExpires &&
      student.emailVerificationOtpExpires > new Date() &&
      !student.passwordResetOtp
    ) {
      return sendError(
        res,
        400,
        "This OTP is for email verification. Use /auth/verify-email instead."
      );
    }

    if (
      !student ||
      !(await compareSecret(otp, student.passwordResetOtp)) ||
      !student.passwordResetOtpExpires ||
      student.passwordResetOtpExpires < new Date()
    ) {
      return sendError(res, 400, "Invalid or expired OTP");
    }

    student.passwordResetOtp = null;
    student.passwordResetOtpExpires = null;
    const resetToken = createOpaqueToken();
    student.passwordResetTokenHash = await hashSecret(resetToken);
    student.passwordResetTokenExpires = new Date(Date.now() + 10 * 60 * 1000);
    await student.save();

    return res.status(200).json({
      resetToken,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to verify reset OTP");
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return sendError(res, 400, "resetToken and newPassword are required");
    }

    if (!isStrongPassword(newPassword)) {
      return sendError(res, 400, strongPasswordMessage);
    }

    const candidates = await Student.find({
      passwordResetTokenExpires: { $gt: new Date() },
    });

    let student = null;
    for (const candidate of candidates) {
      if (await compareSecret(resetToken, candidate.passwordResetTokenHash)) {
        student = candidate;
        break;
      }
    }

    if (!student) {
      return sendError(res, 401, "Invalid or expired reset token");
    }

    student.password = newPassword;
    student.refreshToken = null;
    student.sessionVersion = Number(student.sessionVersion || 0) + 1;
    student.passwordResetTokenHash = null;
    student.passwordResetTokenExpires = null;
    await student.save();

    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Student Password Reset Completed",
    });
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "password_reset_completed",
      title: "Password reset completed",
      message: "Your password has been changed successfully.",
      priority: "high",
    });

    return res.status(200).json({});
  } catch {
    return sendError(res, 401, "Invalid or expired reset token");
  }
};
