import express from "express";
import {
  bootstrapSchoolAdmin,
  getSchoolAdminMe,
  loginSchoolAdmin,
  logoutSchoolAdmin,
  refreshSchoolAdminSession,
} from "../controllers/schoolAdminAuthController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { protectSchoolAdmin } from "../middleware/authSchoolAdmin.js";
import { validate, validators } from "../middleware/validate.js";

const router = express.Router();

router.post("/auth/bootstrap", bootstrapSchoolAdmin);
router.post(
  "/auth/login",
  createRateLimiter({ key: "login-school-admin", windowMs: 15 * 60 * 1000, max: 8 }),
  validate(validators.loginSchoolAdmin),
  loginSchoolAdmin
);
router.post("/auth/refresh", refreshSchoolAdminSession);
router.post("/auth/logout", logoutSchoolAdmin);
router.get("/me", protectSchoolAdmin, getSchoolAdminMe);

export default router;
