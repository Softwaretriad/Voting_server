import { sendError } from "../utils/apiResponse.js";
import {
  isFourDigitPin,
  isStrongPassword,
  normalizeEmail,
  strongPasswordMessage,
} from "../utils/security.js";

export const validate = (validator) => (req, res, next) => {
  const message = validator(req);
  if (message) {
    return sendError(res, 422, message);
  }
  return next();
};

export const validators = {
  registerStudent: (req) => {
    const body = req.body || {};
    if (
      !body.studentId ||
      !body.firstName ||
      !body.lastName ||
      !["male", "female"].includes(body.gender) ||
      !normalizeEmail(body.email) ||
      !body.password ||
      !body.phone ||
      !body.universityFullName ||
      !body.department ||
      body.currentYearOfStudy == null ||
      !body.programOfStudy ||
      body.votingPin == null
    ) {
      return "All required registration fields must be provided";
    }
    if (!isStrongPassword(body.password)) {
      return strongPasswordMessage;
    }
    if (!isFourDigitPin(body.votingPin)) {
      return "Voting PIN must be a 4-digit integer";
    }
    return null;
  },
  loginStudent: (req) =>
    normalizeEmail(req.body?.email) && req.body?.password
      ? null
      : "email and password are required",
  verifyEmailOtp: (req) =>
    normalizeEmail(req.body?.email) && req.body?.otp
      ? null
      : "email and otp are required",
  forgotPassword: (req) =>
    normalizeEmail(req.body?.email) ? null : "email is required",
  resendVerificationOtp: (req) =>
    normalizeEmail(req.body?.email) ? null : "email is required",
  resetPassword: (req) => {
    if (!req.body?.resetToken || !req.body?.newPassword) {
      return "resetToken and newPassword are required";
    }
    if (!isStrongPassword(req.body.newPassword)) {
      return strongPasswordMessage;
    }
    return null;
  },
  forgotVotingPin: (req) =>
    normalizeEmail(req.body?.email) ? null : "email is required",
  verifyVotingPinOtp: (req) =>
    normalizeEmail(req.body?.email) && req.body?.otp
      ? null
      : "email and otp are required",
  resetVotingPin: (req) =>
    req.body?.resetToken && isFourDigitPin(req.body?.newPin)
      ? null
      : "resetToken and a valid 4-digit newPin are required",
  verifyVotingPin: (req) =>
    req.body?.studentId && isFourDigitPin(req.body?.votingPin)
      ? null
      : "studentId and a valid 4-digit votingPin are required",
  castVote: (req) =>
    req.body?.studentId &&
    req.body?.electionId &&
    req.body?.aspirantId &&
    isFourDigitPin(req.body?.votingPin)
      ? null
      : "studentId, electionId, aspirantId, and a valid 4-digit votingPin are required",
  adminElectionList: (req) =>
    ["active", "scheduled", "draft", "closed"].includes(req.query?.status)
      ? null
      : "status query must be one of active, scheduled, draft, or closed",
  adminElectionCreate: (req) => {
    const body = req.body || {};
    if (
      !body.title ||
      !body.startDate ||
      !body.endDate ||
      !Array.isArray(body.categories) ||
      body.categories.length === 0 ||
      !["draft", "scheduled"].includes(body.status)
    ) {
      return "title, startDate, endDate, categories, and status are required";
    }
    return null;
  },
};
