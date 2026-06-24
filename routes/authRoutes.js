import express from "express";
import {
  checkTokens,
  forgotPassword,
  loginStudent,
  logoutStudent,
  refreshSession,
  registerStudent,
  resendVerificationOtp,
  resetPassword,
  verifyEmail,
  verifyResetOtp,
} from "../controllers/studentAuthController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validate, validators } from "../middleware/validate.js";
import { noStore } from "../middleware/noStore.js";

const router = express.Router();
router.use(noStore);

router.post(
  "/register",
  createRateLimiter({ key: "register-student", windowMs: 60 * 60 * 1000, max: 10 }),
  validate(validators.registerStudent),
  registerStudent
);
router.post(
  "/verify-email",
  createRateLimiter({ key: "verify-email", windowMs: 10 * 60 * 1000, max: 10 }),
  validate(validators.verifyEmailOtp),
  verifyEmail
);
router.post(
  "/resend-verification-otp",
  createRateLimiter({
    key: "resend-verification-otp",
    windowMs: 10 * 60 * 1000,
    max: 5,
  }),
  validate(validators.resendVerificationOtp),
  resendVerificationOtp
);
router.post(
  "/login",
  createRateLimiter({ key: "login-student", windowMs: 15 * 60 * 1000, max: 8 }),
  validate(validators.loginStudent),
  loginStudent
);
router.post("/logout", validate(validators.logoutSession), logoutStudent);
router.post(
  "/refresh",
  createRateLimiter({ key: "refresh-student-session", windowMs: 15 * 60 * 1000, max: 30 }),
  validate(validators.refreshSession),
  refreshSession
);
router.post(
  "/check-tokens",
  createRateLimiter({ key: "check-student-tokens", windowMs: 15 * 60 * 1000, max: 60 }),
  checkTokens
);
router.post(
  "/forgot-password",
  createRateLimiter({ key: "forgot-password", windowMs: 15 * 60 * 1000, max: 5 }),
  validate(validators.forgotPassword),
  forgotPassword
);
router.post(
  "/verify-otp",
  createRateLimiter({
    key: "verify-reset-password-otp",
    windowMs: 10 * 60 * 1000,
    max: 10,
  }),
  validate(validators.verifyEmailOtp),
  verifyResetOtp
);
router.post(
  "/reset-password",
  createRateLimiter({ key: "reset-student-password", windowMs: 15 * 60 * 1000, max: 10 }),
  validate(validators.resetPassword),
  resetPassword
);

export default router;
