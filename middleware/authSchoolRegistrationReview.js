import crypto from "crypto";
import { sendError } from "../utils/apiResponse.js";

const tokensMatch = (expected, provided) => {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  return (
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  );
};

export const isSchoolRegistrationReviewRequest = (req) => {
  const expectedToken = String(
    process.env.SCHOOL_REGISTRATION_REVIEW_TOKEN || ""
  ).trim();
  if (!expectedToken) {
    return false;
  }

  const authorization = String(req.headers.authorization || "");
  const bearerToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const providedToken = String(
    req.headers["x-school-review-token"] || bearerToken || ""
  ).trim();

  return tokensMatch(expectedToken, providedToken);
};

export const protectSchoolRegistrationReview = (req, res, next) => {
  if (!String(process.env.SCHOOL_REGISTRATION_REVIEW_TOKEN || "").trim()) {
    return sendError(res, 404, "Route not found");
  }

  if (!isSchoolRegistrationReviewRequest(req)) {
    return sendError(res, 401, "Unauthorized");
  }

  req.schoolRegistrationReviewer = String(
    req.headers["x-reviewer-name"] || "platform-reviewer"
  )
    .trim()
    .slice(0, 120);
  return next();
};
