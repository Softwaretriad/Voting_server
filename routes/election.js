import { Router } from "express";
import { uploadVoters, startElection, dashboard } from "../controllers/electionController.js";
import { protect } from "../middleware/auth.js";
import { requirePlan } from "../middleware/subscription.js";

const router = Router();

router.get("/dashboard", protect, dashboard);
router.post("/upload-voters", protect, requirePlan, uploadVoters);
router.post("/start", protect, requirePlan, startElection);

export default router;
