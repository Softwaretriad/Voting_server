import Student from "../models/Student.js";
import ECUser from "../models/ECUser.js";
import School from "../models/school.js";
import Election from "../models/Election.js";
import Notification from "../models/Notification.js";
import PushDevice from "../models/PushDevice.js";
import { sanitizeStudentProfile, sendError } from "../utils/apiResponse.js";
import { resolveLogoUrl } from "../utils/logoUrl.js";
import sendEmail from "../utils/sendEmail.js";
import { recordActivity } from "../utils/activityLog.js";
import { createOtp, getOtpExpiry } from "../utils/studentAuth.js";
import { hashSecret, normalizeEmail } from "../utils/security.js";
import { notifyStudent } from "../utils/notificationService.js";

const getStudentLogoUrl = async (req, student) => {
  const school = student.schoolId
    ? await School.findById(student.schoolId).select("logoUrl")
    : null;

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
  const elections = await Election.find({
    $or: [{ "votes.studentId": studentObjectId }, { "votes.adminId": studentObjectId }],
  });

  for (const election of elections) {
    let hasChanges = false;

    election.votes.forEach((vote) => {
      if (vote.studentId?.toString() === studentObjectId.toString()) {
        vote.studentId = null;
        hasChanges = true;
      }

      if (vote.adminId?.toString() === studentObjectId.toString()) {
        vote.adminId = null;
        hasChanges = true;
      }
    });

    if (hasChanges) {
      await election.save();
    }
  }
};

export const getStudentProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const student = await Student.findById(userId);

    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to access this profile");
    }

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

    const [existingStudent, existingAdmin] = await Promise.all([
      Student.findOne({
        email: normalizedEmail,
        _id: { $ne: student._id },
      }).select("_id"),
      ECUser.findOne({ email: normalizedEmail }).select("_id"),
    ]);

    if (existingAdmin) {
      return sendError(
        res,
        400,
        "This email address is already associated with an administrator account. Please use a different email."
      );
    }

    if (existingStudent) {
      return sendError(res, 409, "Email already registered");
    }

    student.email = normalizedEmail;
    student.isEmailVerified = false;
    student.refreshToken = null;
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

    const elections = await Election.find({
      "votes.studentId": req.student._id,
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

    const wasAdmin = student.accountRole === "admin";

    await Promise.all([
      anonymizeElectionVotesForDeletedStudent(student._id),
      Notification.deleteMany({
        $or: [{ studentId: student._id }, { adminId: student._id }],
      }),
      PushDevice.deleteMany({
        recipientId: student._id,
        recipientType: { $in: ["student", "admin"] },
      }),
    ]);

    await recordActivity({
      actorType: wasAdmin ? "admin" : "student",
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
