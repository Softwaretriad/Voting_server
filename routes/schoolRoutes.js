import express from "express";
import {
  createSchool,
  checkSubscription,
  getAllSchools,
  getFacultiesBySchool,
  getProgrammesByFaculty,
} from "../controllers/schoolController.js";

const router = express.Router();

router.get("/", getAllSchools);
router.get("/:schoolId/faculties", getFacultiesBySchool);
router.get("/:schoolId/faculties/:facultyId/programmes", getProgrammesByFaculty);
router.post("/register", createSchool);
router.get("/subscription/:schoolId", checkSubscription);

export default router;
