import express from "express";
import { protect } from "../middleware/authEC.js";
import {
  createAdminElection,
  deleteAdminElection,
  getAdminElectionsByStatus,
  scheduleAdminElection,
  updateAdminElection,
} from "../controllers/adminElectionController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { validate, validators } from "../middleware/validate.js";

const router = express.Router();

router.get("/elections", protect, validate(validators.adminElectionList), getAdminElectionsByStatus);
router.post(
  "/elections",
  createRateLimiter({ key: "admin-create-election", windowMs: 10 * 60 * 1000, max: 20 }),
  protect,
  validate(validators.adminElectionCreate),
  createAdminElection
);
router.put("/elections/:electionId", protect, updateAdminElection);
router.patch("/elections/:electionId/schedule", protect, scheduleAdminElection);
router.delete("/elections/:electionId", protect, deleteAdminElection);

export default router;
