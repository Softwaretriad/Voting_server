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
  refreshSession: (req) =>
    req.body?.refreshToken ? null : "refreshToken is required",
  logoutSession: (req) =>
    req.body?.refreshToken ? null : "refreshToken is required",
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
  castAdminVote: (req) =>
    req.body?.adminUserId && req.body?.electionId && req.body?.aspirantId
      ? null
      : "adminUserId, electionId, and aspirantId are required",
  inviteAdminMembers: (req) => {
    const emails = req.body?.emails;
    if (!Array.isArray(emails) || emails.length === 0) {
      return "emails must be a non-empty array";
    }

    const hasInvalidEmail = emails.some((email) => !normalizeEmail(email));
    if (hasInvalidEmail) {
      return "Each email in emails must be valid";
    }

    return null;
  },
  completeAdminInvite: (req) => {
    if (!req.body?.token || !req.body?.name || !req.body?.password) {
      return "token, name, and password are required";
    }
    if (!String(req.body.name).trim()) {
      return "name cannot be empty";
    }
    if (!isStrongPassword(req.body.password)) {
      return strongPasswordMessage;
    }
    return null;
  },
  updateStudentProfile: (req) => {
    const body = req.body || {};
    const hasEditableField =
      body.firstName != null ||
      body.lastName != null ||
      body.phoneNumber != null ||
      body.phone != null;

    if (!hasEditableField) {
      return "At least one of firstName, lastName, or phoneNumber is required";
    }

    if (body.firstName != null && !String(body.firstName).trim()) {
      return "firstName cannot be empty";
    }
    if (body.lastName != null && !String(body.lastName).trim()) {
      return "lastName cannot be empty";
    }

    const resolvedPhone = body.phoneNumber != null ? body.phoneNumber : body.phone;
    if (resolvedPhone != null && !String(resolvedPhone).trim()) {
      return "phoneNumber cannot be empty";
    }

    return null;
  },
  deleteStudentAccount: (req) =>
    req.body?.password ? null : "password is required",
  changeStudentEmail: (req) =>
    normalizeEmail(req.body?.email) ? null : "email must be a valid non-empty email address",
  notificationPreferences: (req) => {
    const body = req.body || {};
    const allowedKeys = [
      "notificationsEnabled",
      "electionAlertsEnabled",
      "resultsEnabled",
      "announcementsEnabled",
      "voterActivityEnabled",
    ];

    const providedKeys = Object.keys(body);
    if (providedKeys.length === 0) {
      return "At least one notification preference field is required";
    }

    const invalidKey = providedKeys.find((key) => !allowedKeys.includes(key));
    if (invalidKey) {
      return `Unsupported notification preference field: ${invalidKey}`;
    }

    const invalidValueKey = providedKeys.find((key) => typeof body[key] !== "boolean");
    if (invalidValueKey) {
      return `${invalidValueKey} must be a boolean`;
    }

    return null;
  },
  registerDeviceToken: (req) => {
    const body = req.body || {};
    if (!body.token || !String(body.token).trim()) {
      return "token is required";
    }

    const allowedPlatforms = ["android", "ios", "web", "unknown"];
    if (
      body.platform != null &&
      !allowedPlatforms.includes(String(body.platform).trim().toLowerCase())
    ) {
      return "platform must be one of android, ios, web, or unknown";
    }

    if (
      body.notificationsEnabled != null &&
      typeof body.notificationsEnabled !== "boolean"
    ) {
      return "notificationsEnabled must be a boolean";
    }

    return null;
  },
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
    if (body.imageUrl != null && typeof body.imageUrl !== "string") {
      return "imageUrl must be a string when provided";
    }
    if (body.voters != null && !Array.isArray(body.voters)) {
      return "voters must be an array when provided";
    }
    if (body.aspirants != null && !Array.isArray(body.aspirants)) {
      return "aspirants must be an array when provided";
    }
    if (body.voters == null || body.voters.length === 0) {
      return "voters is required and must be a non-empty array";
    }
    if (body.aspirants == null || body.aspirants.length === 0) {
      return "aspirants is required and must be a non-empty array";
    }
    const invalidVoter = body.voters.find(
      (voter) =>
        !voter?.name ||
        !voter?.studentId ||
        !voter?.programmeOfStudy ||
        !voter?.level ||
        !voter?.faculty
    );
    if (invalidVoter) {
      return "Each voter must include name, studentId, programmeOfStudy, level, and faculty";
    }
    const invalidAspirant = body.aspirants.find(
      (aspirant) =>
        !aspirant?.name ||
        !aspirant?.studentId ||
        !aspirant?.programmeOfStudy ||
        !aspirant?.level ||
        !aspirant?.faculty ||
        !aspirant?.electoralCategory
    );
    if (invalidAspirant) {
      return "Each aspirant must include name, studentId, programmeOfStudy, level, faculty, and electoralCategory";
    }
    return null;
  },
};
