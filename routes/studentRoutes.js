import express from "express";
import { getStudentProfile } from "../controllers/studentController.js";
import { protectStudent } from "../middleware/authStudent.js";

const router = express.Router();

router.get("/:userId", protectStudent, getStudentProfile);

export default router;
