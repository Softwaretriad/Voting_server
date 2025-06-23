import express from "express";
import { loginVoter, getUserDashboard } from "../controllers/voterController.js";
import { castVote } from "../controllers/votingController.js";
import checkElectionActive from "../middleware/checkElectionStatus.js";

const router = express.Router();

// Voter login
router.post("/login", loginVoter);

// Voter dashboard
router.get("/dashboard/:voterId", getUserDashboard);

// Cast vote (must be within election time)
router.post("/vote", checkElectionActive, castVote);

export default router;
