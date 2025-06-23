import express from "express";
import {loginVoter,verifyOtp,getUserDashboard} from "../controllers/voterController.js";
import { castVote } from "../controllers/votingController.js";
import checkElectionActive from "../middleware/checkElectionStatus.js";
import { protectVoter } from "../middleware/authVoter.js";

const router = express.Router();

// Step 1: Voter requests OTP
router.post("/login", loginVoter);

// Step 2: Voter verifies OTP and receives JWT
router.post("/verify-otp", verifyOtp);

// Voter dashboard (JWT-protected)
router.get("/dashboard/:voterId", protectVoter, getUserDashboard);

// Cast vote (JWT-protected + election still active)
router.post("/vote", protectVoter, checkElectionActive, castVote);


export default router;
