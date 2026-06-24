import express from "express";
import {
  createSchool,
  checkSubscription,
  getAllSchools,
  getFacultiesBySchool,
  getProgrammesByFaculty,
  promoteSchoolAdmins as promoteSchoolEcMembers,
  updateSchoolSubscription,
} from "../controllers/schoolController.js";
import { protectSchoolAdmin } from "../middleware/authSchoolAdmin.js";
import { validate, validators } from "../middleware/validate.js";

const router = express.Router();

router.get("/", getAllSchools);
router.get("/:schoolId/faculties", getFacultiesBySchool);
router.get("/:schoolId/faculties/:facultyId/programmes", getProgrammesByFaculty);
router.post("/register", createSchool);
router.post(
  "/:schoolId/promote-ec-members",
  protectSchoolAdmin,
  validate(validators.inviteAdminMembers),
  promoteSchoolEcMembers
);
router.get("/subscription/:schoolId", checkSubscription);
router.patch("/subscription/:schoolId", protectSchoolAdmin, updateSchoolSubscription);

export default router;
