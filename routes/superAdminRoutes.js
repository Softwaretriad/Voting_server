import express from "express";
import {
  bootstrapSuperAdmin,
  getSuperAdminMe,
  loginSuperAdmin,
  logoutSuperAdmin,
  refreshSuperAdminSession,
} from "../controllers/superAdminAuthController.js";
import {
  assignSchoolPlanBySuperAdmin,
  listPlanUpdateRequestsForSuperAdmin,
  reviewPlanUpdateRequestBySuperAdmin,
} from "../controllers/schoolPortalController.js";
import {
  listPublicLeadRequestsForSuperAdmin,
  updatePublicLeadRequestStatusForSuperAdmin,
} from "../controllers/publicLeadController.js";
import { protectSuperAdmin } from "../middleware/authSuperAdmin.js";
import { noStore } from "../middleware/noStore.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();
router.use(noStore);

router.post(
  "/auth/bootstrap",
  createRateLimiter({ key: "bootstrap-super-admin", windowMs: 60 * 60 * 1000, max: 3 }),
  bootstrapSuperAdmin
);
router.post(
  "/auth/login",
  createRateLimiter({ key: "login-super-admin", windowMs: 15 * 60 * 1000, max: 8 }),
  loginSuperAdmin
);
router.post(
  "/auth/refresh",
  createRateLimiter({ key: "refresh-super-admin", windowMs: 15 * 60 * 1000, max: 30 }),
  refreshSuperAdminSession
);
router.post("/auth/logout", logoutSuperAdmin);
router.get("/me", protectSuperAdmin, getSuperAdminMe);
router.patch(
  "/schools/:schoolId/plan",
  protectSuperAdmin,
  assignSchoolPlanBySuperAdmin
);
router.get(
  "/plan-update-requests",
  protectSuperAdmin,
  listPlanUpdateRequestsForSuperAdmin
);
router.patch(
  "/plan-update-requests/:requestId",
  protectSuperAdmin,
  reviewPlanUpdateRequestBySuperAdmin
);
router.get(
  "/public-leads",
  protectSuperAdmin,
  listPublicLeadRequestsForSuperAdmin
);
router.patch(
  "/public-leads/:requestId",
  protectSuperAdmin,
  updatePublicLeadRequestStatusForSuperAdmin
);

export default router;
