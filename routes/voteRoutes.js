import express from "express";
import {
  castStudentVote,
  forgotVotingPin,
  resetVotingPin,
  verifyVotingPin,
  verifyVotingPinResetOtp,
} from "../controllers/studentVoteController.js";
import { protectStudent } from "../middleware/authStudent.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validate, validators } from "../middleware/validate.js";

const router = express.Router();

router.post(
  "/pin/forgot",
  createRateLimiter({ key: "forgot-voting-pin", windowMs: 15 * 60 * 1000, max: 5 }),
  validate(validators.forgotVotingPin),
  forgotVotingPin
);
router.post(
  "/pin/verify-otp",
  createRateLimiter({
    key: "verify-voting-pin-otp",
    windowMs: 10 * 60 * 1000,
    max: 10,
  }),
  validate(validators.verifyVotingPinOtp),
  verifyVotingPinResetOtp
);
router.post("/pin/reset", validate(validators.resetVotingPin), resetVotingPin);
router.post(
  "/verify-pin",
  createRateLimiter({ key: "verify-voting-pin", windowMs: 15 * 60 * 1000, max: 10 }),
  protectStudent,
  validate(validators.verifyVotingPin),
  verifyVotingPin
);
router.post("/cast", protectStudent, validate(validators.castVote), castStudentVote);

export default router;
