import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";
import sendEmail from "../utils/sendEmail.js";
import { createOtp, getOtpExpiry } from "../utils/studentAuth.js";
import {
  compareSecret,
  createOpaqueToken,
  hashSecret,
  isFourDigitPin,
  normalizeEmail,
} from "../utils/security.js";
import { recordActivity } from "../utils/activityLog.js";
import { emitElectionMonitorUpdate } from "../utils/liveMonitorSocket.js";
import { isStudentEligibleForElection } from "../utils/electionEligibility.js";
import { hasStudentVotedInCategory } from "../utils/voteState.js";
import {
  maybeNotifyTurnoutMilestone,
  notifySchoolAdmins,
  notifyStudent,
} from "../utils/notificationService.js";

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 10;

const resetPinValidationError = (pin) => {
  if (!isFourDigitPin(pin)) {
    return "newPin must be exactly 4 digits";
  }
  return null;
};

export const verifyVotingPin = async (req, res) => {
  try {
    const { studentId, votingPin } = req.body;
    const student = await Student.findById(studentId);

    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    if (req.student._id.toString() !== studentId) {
      return sendError(res, 403, "You are not allowed to verify this PIN");
    }

    if (student.votingPinLockedUntil && student.votingPinLockedUntil > new Date()) {
      return sendError(res, 429, "Too many failed attempts. Please try again later.");
    }

    if (!(await compareSecret(votingPin, student.votingPin))) {
      student.votingPinAttempts += 1;
      if (student.votingPinAttempts >= MAX_PIN_ATTEMPTS) {
        student.votingPinLockedUntil = new Date(
          Date.now() + PIN_LOCK_MINUTES * 60 * 1000
        );
        await notifySchoolAdmins({
          schoolId: student.schoolId,
          type: "suspicious_voting_activity",
          title: "Repeated failed voting PIN attempts",
          message: `${student.firstName} ${student.lastName} triggered repeated failed voting PIN attempts.`,
          priority: "high",
          data: {
            studentId: student._id.toString(),
            attempts: student.votingPinAttempts,
          },
        });
      }
      await student.save();
      return sendError(res, 400, "Incorrect voting PIN. Please try again.");
    }

    student.votingPinAttempts = 0;
    student.votingPinLockedUntil = null;
    await student.save();

    return res.status(200).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to verify voting PIN");
  }
};

export const castStudentVote = async (req, res) => {
  try {
    const { studentId, electionId, aspirantId, votingPin } = req.body;
    const student = await Student.findById(studentId);

    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    if (req.student._id.toString() !== studentId) {
      return sendError(res, 403, "You are not allowed to cast this vote");
    }

    if (!(await compareSecret(votingPin, student.votingPin))) {
      return sendError(res, 400, "Invalid voting PIN");
    }

    const election = await Election.findById(electionId);
    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    if (
      student.schoolId &&
      election.schoolId?.toString() !== student.schoolId.toString()
    ) {
      return sendError(res, 403, "You are not allowed to vote in this election");
    }

    const isEligible = await isStudentEligibleForElection({
      election,
      student,
    });
    if (!isEligible) {
      return sendError(res, 403, "You are not eligible to vote in this election");
    }

    if (election.status !== "active" || new Date() > election.endTime) {
      return sendError(res, 403, "Election is not active");
    }

    const aspirant = await Aspirant.findOne({
      _id: aspirantId,
      electionId,
      ...(student.schoolId ? { schoolId: student.schoolId } : {}),
    });
    if (!aspirant) {
      return sendError(res, 404, "Aspirant not found");
    }

    const aspirantCategoryId = aspirant.categoryId?.toString();
    const hasVotedInCategory = hasStudentVotedInCategory({
      election,
      studentId,
      categoryId: aspirantCategoryId,
    });

    if (hasVotedInCategory) {
      await notifyStudent({
        studentId: student._id,
        schoolId: student.schoolId,
        type: "category_vote_already_completed",
        title: "Category already voted",
        message: `You have already voted in the ${aspirant.electoralCategory} category.`,
        priority: "normal",
        data: {
          electionId: election._id.toString(),
          categoryId: aspirantCategoryId,
          aspirantId: aspirant._id.toString(),
        },
      });
      return sendError(
        res,
        409,
        "You have already cast your vote for this category."
      );
    }

    aspirant.voteCount = (aspirant.voteCount || 0) + 1;
    await aspirant.save();

    election.votes.push({
      candidate: `${aspirant.name} - ${aspirant.electoralCategory}`,
      aspirantId: aspirant._id,
      electionId: election._id,
      categoryId: aspirant.categoryId,
      studentId: student._id,
    });
    await election.save();

    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Student Vote Cast",
      metadata: { electionId: election._id, aspirantId: aspirant._id },
    });
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "vote_cast_successfully",
      title: "Vote cast successfully",
      message: `Your vote for ${aspirant.name} in ${aspirant.electoralCategory} was recorded successfully.`,
      priority: "high",
      data: {
        electionId: election._id.toString(),
        electionTitle: election.title,
        aspirantId: aspirant._id.toString(),
        aspirantName: aspirant.name,
        categoryId: aspirantCategoryId,
        categoryTitle: aspirant.electoralCategory,
      },
    });
    await maybeNotifyTurnoutMilestone(election);
    await emitElectionMonitorUpdate(election._id.toString());

    return res.status(201).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to cast vote");
  }
};

export const forgotVotingPin = async (req, res) => {
  try {
    const { email } = req.body;
    const student = await Student.findOne({ email: normalizeEmail(email) });

    if (!student) {
      return res.status(200).json({});
    }

    const otp = createOtp();
    student.votingPinResetOtp = await hashSecret(otp);
    student.votingPinResetOtpExpires = getOtpExpiry();
    await student.save();

    await sendEmail(
      student.email,
      "Reset your MyUniVote voting PIN",
      `Your MyUniVote voting PIN reset code is ${otp}. It expires in 10 minutes.`
    );

    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Voting PIN Reset Requested",
    });
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "voting_pin_reset_requested",
      title: "Voting PIN reset requested",
      message: "A voting PIN reset OTP has been sent to your email.",
      priority: "high",
    });

    return res.status(200).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to start voting PIN reset");
  }
};

export const verifyVotingPinResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const student = await Student.findOne({
      email: normalizeEmail(email),
    });

    if (
      !student ||
      !(await compareSecret(otp, student.votingPinResetOtp)) ||
      !student.votingPinResetOtpExpires ||
      student.votingPinResetOtpExpires < new Date()
    ) {
      return sendError(res, 400, "This code is incorrect or has expired.");
    }

    student.votingPinResetOtp = null;
    student.votingPinResetOtpExpires = null;
    const resetToken = createOpaqueToken();
    student.votingPinResetTokenHash = await hashSecret(resetToken);
    student.votingPinResetTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
    await student.save();

    return res.status(200).json({
      resetToken,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to verify voting PIN reset OTP");
  }
};

export const resetVotingPin = async (req, res) => {
  try {
    const { resetToken, newPin } = req.body;

    if (!resetToken) {
      return sendError(res, 400, "resetToken is required");
    }

    const pinError = resetPinValidationError(newPin);
    if (pinError) {
      return sendError(res, 422, pinError);
    }

    const students = await Student.find({
      votingPinResetTokenExpires: { $gt: new Date() },
    });

    let student = null;
    for (const candidate of students) {
      if (await compareSecret(resetToken, candidate.votingPinResetTokenHash)) {
        student = candidate;
        break;
      }
    }

    if (!student) {
      return sendError(res, 400, "Invalid or expired resetToken");
    }

    student.votingPin = String(newPin);
    student.votingPinResetTokenHash = null;
    student.votingPinResetTokenExpires = null;
    student.votingPinAttempts = 0;
    student.votingPinLockedUntil = null;
    await student.save();

    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Voting PIN Reset Completed",
    });
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "voting_pin_reset_completed",
      title: "Voting PIN reset completed",
      message: "Your voting PIN has been changed successfully.",
      priority: "high",
    });

    return res.status(200).json({});
  } catch {
    return sendError(res, 400, "Invalid or expired resetToken");
  }
};
