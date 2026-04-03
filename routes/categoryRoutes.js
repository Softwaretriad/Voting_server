import express from "express";
import { getCategoryResults } from "../controllers/studentElectionController.js";
import { protectStudent } from "../middleware/authStudent.js";

const router = express.Router();

router.get("/:categoryId/results", protectStudent, getCategoryResults);

export default router;
