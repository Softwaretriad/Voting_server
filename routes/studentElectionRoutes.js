import express from "express";
import {
  getActiveElections,
  getElectionById,
  getAspirantsForElection,
  getElectionCategories,
  getElectionResults,
  getElectionSchedule,
  getElectionStatistics,
} from "../controllers/studentElectionController.js";
import { protectStudent } from "../middleware/authStudent.js";

const router = express.Router();

router.get("/active", protectStudent, getActiveElections);
router.get("/schedule", protectStudent, getElectionSchedule);
router.get("/statistics", protectStudent, getElectionStatistics);
router.get("/results", protectStudent, getElectionResults);
router.get("/:electionId", protectStudent, getElectionById);
router.get("/:electionId/categories", protectStudent, getElectionCategories);
router.get("/:electionId/aspirants", protectStudent, getAspirantsForElection);

export default router;
