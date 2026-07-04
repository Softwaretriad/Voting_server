import express from "express";
import {
  approveSchoolRegistration,
  downloadSchoolRegistrationDocument,
  listSchoolRegistrationApplications,
  rejectSchoolRegistration,
} from "../controllers/schoolRegistrationReviewController.js";
import { protectSuperAdmin } from "../middleware/authSuperAdmin.js";
import { noStore } from "../middleware/noStore.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();
const reviewRateLimit = createRateLimiter({
  key: "school-registration-review",
  windowMs: 60 * 1000,
  max: 60,
});

router.use(noStore, reviewRateLimit, protectSuperAdmin);
router.get("/", listSchoolRegistrationApplications);
router.get(
  "/:schoolId/documents/:documentId",
  downloadSchoolRegistrationDocument
);
router.patch("/:schoolId/approve", approveSchoolRegistration);
router.patch("/:schoolId/reject", rejectSchoolRegistration);

export default router;
