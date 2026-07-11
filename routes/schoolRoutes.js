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
import {
  handleImageUploadError,
  uploadSchoolLogo,
} from "../controllers/uploadController.js";
import {
  createPlanUpdateRequest,
  getAssignedPlan,
  getLatestStudentRegisterImport,
  getSchoolProfile,
  importStudentRegister,
  searchRegisteredStudents,
  updateSchoolProfile,
} from "../controllers/schoolPortalController.js";
import {
  getAdminActivity as getSchoolAdminActivity,
  getAdminDashboard as getSchoolAdminDashboard,
  getAdminElectionMonitor as getSchoolAdminElectionMonitor,
  getAdminElectionReport as getSchoolAdminElectionReport,
  getAdminReports as getSchoolAdminReports,
} from "../controllers/adminInsightsController.js";
import {
  listECMembers as listSchoolEcMembers,
  removeECMember as removeSchoolEcMember,
} from "../controllers/ecController.js";
import { protectSchoolAdmin } from "../middleware/authSchoolAdmin.js";
import { requireSchoolAdminCsrf } from "../middleware/csrfSchoolAdmin.js";
import { validate, validators } from "../middleware/validate.js";
import { noStore } from "../middleware/noStore.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import {
  parseSchoolRegistrationPayload,
  uploadSchoolDocuments,
} from "../middleware/uploadSchoolDocuments.js";
import { uploadStudentRegister } from "../middleware/uploadStudentRegister.js";
import { uploadLogo } from "../middleware/uploadImage.js";
import { rejectMongoOperatorKeys } from "../middleware/noSqlProtection.js";
import { enforceInputLimits } from "../middleware/inputLimits.js";

const router = express.Router();

router.get("/", getAllSchools);
router.get("/:schoolId/faculties", getFacultiesBySchool);
router.get("/:schoolId/faculties/:facultyId/programmes", getProgrammesByFaculty);
router.post(
  "/logos",
  noStore,
  createRateLimiter({ key: "upload-school-logo", windowMs: 60 * 60 * 1000, max: 20 }),
  uploadLogo,
  handleImageUploadError,
  rejectMongoOperatorKeys,
  uploadSchoolLogo
);
router.post(
  "/register",
  noStore,
  createRateLimiter({ key: "register-school", windowMs: 60 * 60 * 1000, max: 5 }),
  uploadSchoolDocuments,
  parseSchoolRegistrationPayload,
  rejectMongoOperatorKeys,
  enforceInputLimits,
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
router.post(
  "/:schoolId/ec-members",
  noStore,
  protectSchoolAdmin,
  requireSchoolAdminCsrf,
  validate(validators.inviteAdminMembers),
  promoteSchoolEcMembers
);
router.get(
  "/:schoolId/ec-members",
  noStore,
  protectSchoolAdmin,
  listSchoolEcMembers
);
router.delete(
  "/:schoolId/ec-members/:ecId",
  noStore,
  protectSchoolAdmin,
  requireSchoolAdminCsrf,
  removeSchoolEcMember
);
router.get("/:schoolId/plan", noStore, protectSchoolAdmin, getAssignedPlan);
router.post(
  "/:schoolId/plan-update-requests",
  noStore,
  protectSchoolAdmin,
  requireSchoolAdminCsrf,
  createPlanUpdateRequest
);
router.post(
  "/:schoolId/students/import",
  noStore,
  protectSchoolAdmin,
  requireSchoolAdminCsrf,
  uploadStudentRegister,
  importStudentRegister
);
router.get(
  "/:schoolId/students/imports/latest",
  noStore,
  protectSchoolAdmin,
  getLatestStudentRegisterImport
);
router.get(
  "/:schoolId/students/search",
  noStore,
  protectSchoolAdmin,
  searchRegisteredStudents
);
router.get(
  "/:schoolId/analytics/dashboard",
  noStore,
  protectSchoolAdmin,
  getSchoolAdminDashboard
);
router.get(
  "/:schoolId/analytics/monitor/elections/:electionId",
  noStore,
  protectSchoolAdmin,
  getSchoolAdminElectionMonitor
);
router.get(
  "/:schoolId/analytics/reports/elections/:electionId",
  noStore,
  protectSchoolAdmin,
  getSchoolAdminElectionReport
);
router.get(
  "/:schoolId/analytics/reports",
  noStore,
  protectSchoolAdmin,
  getSchoolAdminReports
);
router.get(
  "/:schoolId/analytics/activity",
  noStore,
  protectSchoolAdmin,
  getSchoolAdminActivity
);
router.get("/subscription/:schoolId", noStore, checkSubscription);
router.patch(
  "/subscription/:schoolId",
  noStore,
  protectSchoolAdmin,
  requireSchoolAdminCsrf,
  updateSchoolSubscription
);
router.get("/:schoolId", noStore, protectSchoolAdmin, getSchoolProfile);
router.patch(
  "/:schoolId",
  noStore,
  protectSchoolAdmin,
  requireSchoolAdminCsrf,
  rejectMongoOperatorKeys,
  enforceInputLimits,
  updateSchoolProfile
);

export default router;
