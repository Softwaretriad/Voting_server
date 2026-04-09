import ECUser from "../models/ECUser.js";
import School from "../models/school.js";
import Student from "../models/Student.js";
import jwt from "jsonwebtoken";
import sendEmail from "../utils/sendEmail.js";
import { sendError, sanitizeStudent } from "../utils/apiResponse.js";
import {
  createOtp,
  getOtpExpiry,
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

const sendVerificationOtp = async (student) => {
  const otp = createOtp();
  student.emailVerificationOtp = await hashSecret(otp);
  student.emailVerificationOtpExpires = getOtpExpiry();
  await student.save();

  await sendEmail(
    student.email,
    "Verify your MyUniVote email",
    `Your MyUniVote verification code is ${otp}. It expires in 10 minutes.`
  );
};

const issueSession = async (student) => {
  const accessToken = signAccessToken(student);
  const refreshToken = signRefreshToken(student);

  student.refreshToken = await hashSecret(refreshToken);
  await student.save();

  return {
    accessToken,
    refreshToken,
    user: sanitizeStudent(student),
  };
};

const issueAdminSession = async (admin) => {
  const token = jwt.sign(
    {
      userId: admin._id,
      schoolId: admin.schoolId,
      role: "admin",
    },
    process.env.JWT_SECRET,
    { expiresIn: "1d" }
  );

  return {
    token,
    accessToken: token,
    role: "admin",
    user: {
      id: admin._id,
      name: admin.name,
      email: admin.email,
      schoolId: admin.schoolId,
    },
  };
};

const resolveSchoolSelection = async ({
  universityFullName,
  department,
  programOfStudy,
}) => {
  const school = await School.findOne({
    $or: [{ fullName: universityFullName }, { name: universityFullName }],
  });

  if (!school) {
    return { error: "Selected university was not found in the school list" };
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
      votingPin,
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
      currentYearOfStudy == null ||
      !programOfStudy ||
      votingPin == null
    ) {
      return sendError(res, 400, "All required registration fields must be provided");
    }

    if (!isStrongPassword(password)) {
      return sendError(res, 400, strongPasswordMessage);
    }

    if (!isFourDigitPin(votingPin)) {
      return sendError(res, 400, "Voting PIN must be a 4-digit integer");
    }

    const [existingStudent, existingAdmin] = await Promise.all([
      Student.findOne({ email: normalizedEmail }),
      ECUser.findOne({ email: normalizedEmail }),
    ]);

    if (existingAdmin) {
      return sendError(
        res,
        400,
        "This email address is already associated with an administrator account. Please use your student email to register."
      );
    }

    if (existingStudent) {
      return sendError(res, 409, "Email already registered");
    }

    const { school, error: schoolError } = await resolveSchoolSelection({
      universityFullName,
      department,
      programOfStudy,
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
      currentYearOfStudy: Number(currentYearOfStudy),
      programOfStudy,
      votingPin: String(votingPin),
    });

    await sendVerificationOtp(student);
    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Student Registration Initiated",
    });

    return res.status(201).json({ email: student.email });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to register student");
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const student = await Student.findOne({ email: normalizeEmail(email) });

    if (
      !student ||
      !(await compareSecret(otp, student.emailVerificationOtp)) ||
      !student.emailVerificationOtpExpires ||
      student.emailVerificationOtpExpires < new Date()
    ) {
      return sendError(res, 400, "Invalid or expired OTP");
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

    const session = await issueSession(student);
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

    await sendVerificationOtp(student);
    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Student Verification OTP Resent",
    });

    return res.status(200).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to resend verification OTP");
  }
};

export const loginStudent = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const [student, admin] = await Promise.all([
      Student.findOne({ email: normalizedEmail }),
      ECUser.findOne({ email: normalizedEmail }),
    ]);

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

      const session = await issueSession(student);
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

    const adminPasswordMatches = admin
      ? await admin.matchPassword(password || "")
      : false;

    if (adminPasswordMatches) {
      const session = await issueAdminSession(admin);
      await recordActivity({
        actorType: "admin",
        actorId: admin._id,
        schoolId: admin.schoolId,
        action: "Admin Login Success",
      });
      return res.status(200).json(session);
    }

    return sendError(res, 401, "Invalid email or password");
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to login");
  }
};

export const logoutStudent = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const authHeader = req.headers.authorization;

    if (!refreshToken) {
      return sendError(res, 400, "refreshToken is required");
    }

    if (!authHeader?.startsWith("Bearer ")) {
      return sendError(res, 401, "Authorization header is required");
    }

    const decoded = verifyToken(authHeader.split(" ")[1]);
    const student = await Student.findById(decoded.studentId);

    if (!student) {
      return sendError(res, 401, "Student not found");
    }

    if (await compareSecret(refreshToken, student.refreshToken)) {
      student.refreshToken = null;
      await student.save();
    }

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
      const student = await Student.findById(decodedAccess.studentId);

      if (student && (await compareSecret(refreshToken, student.refreshToken))) {
        return res.status(200).json({
          user: sanitizeStudent(student),
        });
      }
    } catch {
      // Fall through to refresh flow.
    }

    const decodedRefresh = verifyToken(refreshToken);
    if (decodedRefresh.type !== "refresh") {
      return sendError(res, 401, "Invalid refresh token");
    }

    const student = await Student.findById(decodedRefresh.studentId);
    if (!student || !(await compareSecret(refreshToken, student.refreshToken))) {
      return sendError(res, 401, "Invalid refresh token");
    }

    const newAccessToken = signAccessToken(student);
    const newRefreshToken = signRefreshToken(student);

    student.refreshToken = await hashSecret(newRefreshToken);
    await student.save();

    return res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      user: sanitizeStudent(student),
    });
  } catch {
    return sendError(res, 401, "Invalid or expired tokens");
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
    student.passwordResetTokenHash = null;
    student.passwordResetTokenExpires = null;
    await student.save();

    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Student Password Reset Completed",
    });

    return res.status(200).json({});
  } catch {
    return sendError(res, 401, "Invalid or expired reset token");
  }
};
