import { Router } from "express";
import { uploadVoters, startElection, } from "../controllers/electionController.js";
import { protect } from "../middleware/authEC.js";
import { requirePlan } from "../middleware/subscription.js";

const router = Router();


router.post("/upload-voters", protect, uploadVoters);
router.post("/start", protect, requirePlan, startElection);

export default router;
