import { sendError } from "../utils/apiResponse.js";
import {
  isFourDigitPin,
  isValidEmail,
} from "../utils/security.js";

export const validate = (validator) => (req, res, next) => {
  const message = validator(req);
  if (message) {
    return sendError(res, 422, message);
  }
  return next();
};

export const validators = {
  googleStudentLogin: (req) =>
    req.body?.idToken && String(req.body.idToken).trim()
      ? null
      : "idToken is required",
  loginSchoolAdmin: (req) =>
    isValidEmail(req.body?.email) && req.body?.password
      ? null
      : "a valid email and password are required",
  refreshSession: (req) =>
    req.body?.refreshToken ? null : "refreshToken is required",
  logoutSession: (req) =>
    req.body?.refreshToken ? null : "refreshToken is required",
  forgotVotingPin: (req) =>
    isValidEmail(req.body?.email) ? null : "a valid email is required",
  verifyVotingPinOtp: (req) =>
    isValidEmail(req.body?.email) && req.body?.otp
      ? null
      : "a valid email and otp are required",
  resetVotingPin: (req) =>
    req.body?.resetToken && isFourDigitPin(req.body?.newPin)
      ? null
      : "resetToken and a valid 4-digit newPin are required",
  setVotingPin: (req) =>
    isFourDigitPin(req.body?.newPin)
      ? null
      : "newPin must be exactly 4 digits",
  verifyVotingPin: (req) =>
    req.body?.studentId && isFourDigitPin(req.body?.votingPin)
      ? null
      : "studentId and a valid 4-digit votingPin are required",
  castVote: (req) =>
    req.body?.studentId &&
    req.body?.electionId &&
    req.body?.aspirantId &&
    (req.body?.votingPin == null || isFourDigitPin(req.body?.votingPin))
      ? null
      : "studentId, electionId, aspirantId, and a valid 4-digit votingPin when provided are required",
  castEcVote: (req) =>
    req.body?.ecUserId &&
    req.body?.electionId &&
    req.body?.aspirantId
      ? null
      : "ecUserId, electionId, and aspirantId are required",
  inviteAdminMembers: (req) => {
    const members = req.body?.members;
    if (!Array.isArray(members) || members.length === 0) {
      return "members must be a non-empty array";
    }

    const hasInvalidMember = members.some(
      (member) =>
        !String(member?.studentId || "").trim() || !isValidEmail(member?.email)
    );
    if (hasInvalidMember) {
      return "Each member must include a valid studentId and email";
    }

    return null;
  },
  deleteStudentAccount: (req) =>
    req.body?.password ? null : "password is required",
  changeStudentEmail: (req) =>
    isValidEmail(req.body?.email) ? null : "email must be a valid email address",
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
  ecElectionList: (req) =>
    ["active", "scheduled", "draft", "closed"].includes(req.query?.status)
      ? null
      : "status query must be one of active, scheduled, draft, or closed",
  ecElectionCreate: (req) => {
    const body = req.body || {};
    if (!body.title || body.status !== "draft") {
      return "title and status=draft are required";
    }

    if (!Array.isArray(body.categories) || body.categories.length === 0) {
      return "categories must be a non-empty array";
    }
    if (body.imageUrl != null && typeof body.imageUrl !== "string") {
      return "imageUrl must be a string when provided";
    }
    if (body.voters != null || body.voterListUrl != null || body.keepExistingVoters != null) {
      return "EC voter-list uploads are no longer supported; use audience filters";
    }
    if (body.aspirants != null || body.aspirantListUrl != null) {
      return "Aspirant list uploads are no longer supported; use student search and category assignment";
    }
    return null;
  },
};
