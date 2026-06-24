import mongoose from "mongoose";
import Student from "../models/Student.js";
import School from "../models/school.js";
import Election from "../models/Election.js";
import Notification from "../models/Notification.js";
import PushDevice from "../models/PushDevice.js";
import Vote from "../models/Vote.js";
import { sanitizeStudentProfile, sendError } from "../utils/apiResponse.js";
import { resolveLogoUrl } from "../utils/logoUrl.js";
import sendEmail from "../utils/sendEmail.js";
import { recordActivity } from "../utils/activityLog.js";
import { createOtp, getOtpExpiry } from "../utils/studentAuth.js";
import { hashSecret, normalizeEmail } from "../utils/security.js";
import { emailMatchesAllowedDomains } from "../utils/emailDomains.js";
import { notifyStudent } from "../utils/notificationService.js";
import { EC_ROLE, isEcAccountRole } from "../utils/ecRole.js";

const SCHOOL_LOGO_CACHE_TTL_MS = Number(process.env.SCHOOL_LOGO_CACHE_TTL_MS || 30000);
const schoolLogoCache = new Map();

const getStudentLogoUrl = async (req, student) => {
  const schoolId = student.schoolId?.toString?.();
  if (!schoolId) {
    return resolveLogoUrl(req, "");
  }

  const cached = schoolLogoCache.get(schoolId);
  if (cached && cached.expiresAt > Date.now()) {
    return resolveLogoUrl(req, cached.logoUrl);
  }

  const school = await School.findById(student.schoolId).select("logoUrl").lean();
  schoolLogoCache.set(schoolId, {
    logoUrl: school?.logoUrl || "",
    expiresAt: Date.now() + SCHOOL_LOGO_CACHE_TTL_MS,
  });

  return resolveLogoUrl(req, school?.logoUrl);
};

const sendUpdatedEmailVerificationOtp = async (student) => {
  const otp = createOtp();
  student.emailVerificationOtp = await hashSecret(otp);
  student.emailVerificationOtpExpires = getOtpExpiry();
  await student.save();

  await sendEmail(
    student.email,
    "Verify your updated MyUniVote email",
    `Your MyUniVote verification code is ${otp}. It expires in 10 minutes.`
  );
};

const anonymizeElectionVotesForDeletedStudent = async (studentObjectId) => {
  const storedVotes = await Vote.find({ voterId: studentObjectId }).select("_id");
  await Promise.all(
    storedVotes.map((vote) =>
      Vote.updateOne(
        { _id: vote._id },
        {
          $set: {
            voterId: new mongoose.Types.ObjectId(),
            studentId: null,
            ecUserId: null,
          },
        }
      )
    )
  );

};

export const getStudentProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to access this profile");
    }

    const student = req.student;

    return res.status(200).json(
      sanitizeStudentProfile(student, {
        universityLogoUrl: await getStudentLogoUrl(req, student),
      })
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load student profile");
  }
};

export const updateStudentProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const { firstName, lastName, phoneNumber, phone } = req.body || {};

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to update this profile");
    }

    const student = await Student.findById(userId);
    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    if (firstName != null) {
      student.firstName = String(firstName).trim();
    }
    if (lastName != null) {
      student.lastName = String(lastName).trim();
    }

    const resolvedPhone = phoneNumber != null ? phoneNumber : phone;
    if (resolvedPhone != null) {
      student.phone = String(resolvedPhone).trim();
    }

    if (!student.firstName || !student.lastName || !student.phone || !student.email) {
      return sendError(res, 400, "firstName, lastName, phone, and email cannot be empty");
    }

    await student.save();
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "profile_updated",
      title: "Profile updated",
      message: "Your profile details were updated successfully.",
      priority: "low",
    });

    return res.status(200).json({
      ...sanitizeStudentProfile(student, {
        universityLogoUrl: await getStudentLogoUrl(req, student),
      }),
      message: "Profile updated successfully",
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to update student profile");
  }
};

export const changeStudentEmail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { email } = req.body || {};

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to change this email");
    }

    const student = await Student.findById(userId);
    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      return sendError(res, 400, "email cannot be empty");
    }

    if (normalizedEmail === student.email) {
      return sendError(res, 409, "Please provide a different email address");
    }

    const school = await School.findById(student.schoolId)
      .select("allowedEmailDomains")
      .lean();
    if (!school?.allowedEmailDomains?.length) {
      return sendError(res, 400, "Your university has no allowed email domains configured");
    }
    if (!emailMatchesAllowedDomains(normalizedEmail, school.allowedEmailDomains)) {
      return sendError(
        res,
        400,
        `Email must use one of your university's allowed domains: ${school.allowedEmailDomains.join(
          ", "
        )}`
      );
    }

    const existingStudent = await Student.findOne({
      email: normalizedEmail,
      _id: { $ne: student._id },
    }).select("_id");
    if (existingStudent) {
      return sendError(res, 409, "Email already registered");
    }

    student.email = normalizedEmail;
    student.isEmailVerified = false;
    student.refreshToken = null;
    student.sessionVersion = Number(student.sessionVersion || 0) + 1;
    await student.save();

    await sendUpdatedEmailVerificationOtp(student);
    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Student Email Change Verification Sent",
    });
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "email_changed",
      title: "Email changed",
      message: "Your email was changed. Please verify the new address with the OTP sent to it.",
      priority: "high",
      data: {
        email: student.email,
      },
    });

    return res.status(200).json({
      ...sanitizeStudentProfile(student, {
        universityLogoUrl: await getStudentLogoUrl(req, student),
      }),
      verificationEmailSent: true,
      message:
        "Email updated. Please verify your new email address with the OTP sent to it.",
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to change email");
  }
};

export const getStudentVoteHistory = async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to access this vote history");
    }

    const voteElectionIds = await Vote.distinct("electionId", {
      voterId: req.student._id,
      ...(req.student.schoolId ? { schoolId: req.student.schoolId } : {}),
    });
    const elections = await Election.find({
      _id: { $in: voteElectionIds },
      ...(req.student.schoolId ? { schoolId: req.student.schoolId } : {}),
    }).sort({ startTime: -1, createdAt: -1 });

    const groupedHistory = new Map();

    elections.forEach((election) => {
      const startDate = election.startTime || election.endTime || election.createdAt;
      const year = startDate ? new Date(startDate).getUTCFullYear() : new Date().getUTCFullYear();

      if (!groupedHistory.has(year)) {
        groupedHistory.set(year, []);
      }

      groupedHistory.get(year).push({
        _id: election._id.toString(),
        electionName: election.title,
        voteStatus: "voted",
        hasVoted: true,
        categoriesCount: election.categories?.length || 0,
        electionStartedAt: election.startTime ? election.startTime.toISOString() : null,
      });
    });

    const years = Array.from(groupedHistory.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, items]) => ({
        year,
        elections: items.sort((a, b) => {
          const aTime = a.electionStartedAt ? new Date(a.electionStartedAt).getTime() : 0;
          const bTime = b.electionStartedAt ? new Date(b.electionStartedAt).getTime() : 0;
          return bTime - aTime;
        }),
      }));

    return res.status(200).json({
      studentId: req.student._id.toString(),
      years,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load vote history");
  }
};

export const deleteStudentAccount = async (req, res) => {
  try {
    const { userId } = req.params;
    const { password } = req.body || {};

    if (req.accountStudent._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to delete this account");
    }

    if (!password) {
      return sendError(res, 400, "password is required");
    }

    const student = await Student.findById(userId);
    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    const passwordMatches = await student.matchPassword(password);
    if (!passwordMatches) {
      return sendError(res, 401, "Invalid password");
    }

    const wasAdmin = isEcAccountRole(student.accountRole);

    await Promise.all([
      anonymizeElectionVotesForDeletedStudent(student._id),
      Notification.deleteMany({
        $or: [{ studentId: student._id }, { ecUserId: student._id }],
      }),
      PushDevice.deleteMany({
        recipientId: student._id,
        recipientType: { $in: ["student", EC_ROLE] },
      }),
    ]);

    await recordActivity({
      actorType: wasAdmin ? EC_ROLE : "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Account Deleted",
      metadata: {
        email: student.email,
        studentId: student.studentId,
        retainedElectionAuditData: true,
      },
    });

    await Student.findByIdAndDelete(student._id);

    return res.status(200).json({
      message: "Account deleted successfully",
      retainedElectionAuditData: true,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to delete account");
  }
};
