import express from "express";
import {
  checkTokens,
  loginWithGoogle,
  logoutStudent,
  refreshSession,
} from "../controllers/studentAuthController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validate, validators } from "../middleware/validate.js";
import { noStore } from "../middleware/noStore.js";

const router = express.Router();
router.use(noStore);

router.post(
  "/google",
  createRateLimiter({ key: "login-google-student", windowMs: 15 * 60 * 1000, max: 12 }),
  validate(validators.googleStudentLogin),
  loginWithGoogle
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

export default router;
