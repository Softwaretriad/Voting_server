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
import { requireSchoolAdminCsrf } from "../middleware/csrfSchoolAdmin.js";
import { validate, validators } from "../middleware/validate.js";
import { noStore } from "../middleware/noStore.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

router.get("/", getAllSchools);
router.get("/:schoolId/faculties", getFacultiesBySchool);
router.get("/:schoolId/faculties/:facultyId/programmes", getProgrammesByFaculty);
router.post(
  "/register",
  noStore,
  createRateLimiter({ key: "register-school", windowMs: 60 * 60 * 1000, max: 5 }),
  createSchool
);
router.post(
  "/:schoolId/promote-ec-members",
  noStore,
  protectSchoolAdmin,
  requireSchoolAdminCsrf,
  validate(validators.inviteAdminMembers),
  promoteSchoolEcMembers
);
router.get("/subscription/:schoolId", noStore, checkSubscription);
router.patch(
  "/subscription/:schoolId",
  noStore,
  protectSchoolAdmin,
  requireSchoolAdminCsrf,
  updateSchoolSubscription
);

export default router;
