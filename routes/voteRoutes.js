import express from "express";
import {
  castStudentVote,
  forgotVotingPin,
  resetVotingPin,
  setVotingPin,
  verifyVotingPin,
  verifyVotingPinResetOtp,
} from "../controllers/studentVoteController.js";
import { protectStudent, protectVotingStudent } from "../middleware/authStudent.js";
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
  "/pin/set",
  createRateLimiter({ key: "set-voting-pin", windowMs: 15 * 60 * 1000, max: 5 }),
  protectStudent,
  validate(validators.setVotingPin),
  setVotingPin
);
router.post(
  "/verify-pin",
  createRateLimiter({ key: "verify-voting-pin", windowMs: 15 * 60 * 1000, max: 10 }),
  protectStudent,
  validate(validators.verifyVotingPin),
  verifyVotingPin
);
router.post("/cast", protectVotingStudent, validate(validators.castVote), castStudentVote);

export default router;
