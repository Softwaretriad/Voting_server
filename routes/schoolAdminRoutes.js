import express from "express";
import {
  getSchoolAdminMe,
  loginSchoolAdmin,
  logoutSchoolAdmin,
  refreshSchoolAdminSession,
} from "../controllers/schoolAdminAuthController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { protectSchoolAdmin } from "../middleware/authSchoolAdmin.js";
import { requireSchoolAdminCsrf } from "../middleware/csrfSchoolAdmin.js";
import { validate, validators } from "../middleware/validate.js";
import { noStore } from "../middleware/noStore.js";

const router = express.Router();
router.use(noStore);

router.post(
  "/auth/login",
  createRateLimiter({ key: "login-school-admin", windowMs: 15 * 60 * 1000, max: 8 }),
  validate(validators.loginSchoolAdmin),
  loginSchoolAdmin
);
router.post(
  "/auth/refresh",
  createRateLimiter({ key: "refresh-school-admin", windowMs: 15 * 60 * 1000, max: 30 }),
  requireSchoolAdminCsrf,
  refreshSchoolAdminSession
);
router.post("/auth/logout", requireSchoolAdminCsrf, logoutSchoolAdmin);
router.get("/me", protectSchoolAdmin, getSchoolAdminMe);

export default router;
