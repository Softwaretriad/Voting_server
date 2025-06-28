import express from "express";
import {loginVoter, verifyOtp, getUserDashboard, getVoterById,} from "../controllers/voterController.js";
import { castVote } from "../controllers/votingController.js";
import checkElectionActive from "../middleware/checkElectionStatus.js";
import {protectVoter, isVoterVerified,} from "../middleware/authVoter.js"; 

const router = express.Router();

// Step 1: Voter requests OTP
router.post("/login", loginVoter);

// Step 2: Voter verifies OTP and receives JWT
router.post("/verify-otp", verifyOtp);

// ✅ Protected dashboard route
router.get("/dashboard/:voterId", protectVoter, isVoterVerified, getUserDashboard);

// ✅ Protected vote casting route
router.post("/vote", protectVoter, isVoterVerified, checkElectionActive, castVote);

// ✅ Protected get voter profile route
router.get("/:voterId", protectVoter, isVoterVerified, getVoterById);

export default router;
