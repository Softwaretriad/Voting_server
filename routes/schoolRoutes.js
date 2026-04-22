import express from "express";
import {
  createSchool,
  checkSubscription,
  getAllSchools,
  getFacultiesBySchool,
  getProgrammesByFaculty,
  updateSchoolSubscription,
} from "../controllers/schoolController.js";
import { protect } from "../middleware/authEC.js";

const router = express.Router();

router.get("/", getAllSchools);
router.get("/:schoolId/faculties", getFacultiesBySchool);
router.get("/:schoolId/faculties/:facultyId/programmes", getProgrammesByFaculty);
router.post("/register", createSchool);
router.get("/subscription/:schoolId", checkSubscription);
router.patch("/subscription/:schoolId", protect, updateSchoolSubscription);

export default router;
