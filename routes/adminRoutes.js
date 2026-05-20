import express from "express";
import { protect } from "../middleware/authEC.js";
import {
  completeAdminInvite,
  forgotAdminPassword,
  getAdminInviteDetails,
  resetAdminPassword,
  verifyAdminResetOtp,
} from "../controllers/authController.js";
import {
  castAdminVote,
  getAdminVoteHistory,
} from "../controllers/adminVoteController.js";
import {
  createAdminElection,
  deleteAdminElection,
  getAdminElectionById,
  getAdminElectionAspirants,
  getAdminElectionCategories,
  getAdminElectionsByStatus,
  scheduleAdminElection,
  updateAdminElection,
} from "../controllers/adminElectionController.js";
import {
  getAdminActivity,
  getAdminDashboard,
  getAdminElectionMonitor,
  getAdminElectionReport,
  getAdminReports,
} from "../controllers/adminInsightsController.js";
import {
  getAdminNotificationPreferences,
  getAdminNotifications,
  markAdminNotificationAsRead,
  updateAdminNotificationPreferences,
} from "../controllers/notificationController.js";
import {
  handleImageUploadError,
  uploadAdminImage,
  uploadElectionImage,
} from "../controllers/uploadController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { uploadImage } from "../middleware/uploadImage.js";
import { validate, validators } from "../middleware/validate.js";

const router = express.Router();

router.post(
  "/auth/forgot-password",
  createRateLimiter({ key: "admin-forgot-password", windowMs: 15 * 60 * 1000, max: 5 }),
  validate(validators.forgotPassword),
  forgotAdminPassword
);
router.post(
  "/auth/verify-otp",
  createRateLimiter({
    key: "admin-verify-reset-password-otp",
    windowMs: 10 * 60 * 1000,
    max: 10,
  }),
  validate(validators.verifyEmailOtp),
  verifyAdminResetOtp
);
router.post(
  "/auth/reset-password",
  validate(validators.resetPassword),
  resetAdminPassword
);
router.get("/auth/invite", getAdminInviteDetails);
router.post(
  "/auth/complete-invite",
  validate(validators.completeAdminInvite),
  completeAdminInvite
);
router.post("/votes/cast", protect, validate(validators.castAdminVote), castAdminVote);
router.get("/votes/history/:adminUserId", protect, getAdminVoteHistory);
router.get("/notifications/:adminUserId", protect, getAdminNotifications);
router.patch(
  "/notifications/:adminUserId/:notificationId/read",
  protect,
  markAdminNotificationAsRead
);
router.get(
  "/:adminUserId/notification-preferences",
  protect,
  getAdminNotificationPreferences
);
router.patch(
  "/:adminUserId/notification-preferences",
  protect,
  validate(validators.notificationPreferences),
  updateAdminNotificationPreferences
);

router.get("/dashboard/:schoolId", protect, getAdminDashboard);
router.get("/monitor/elections/:electionId", protect, getAdminElectionMonitor);
router.post("/uploads/images", protect, uploadImage, handleImageUploadError, uploadAdminImage);
router.post(
  "/uploads/election-images",
  protect,
  uploadImage,
  handleImageUploadError,
  uploadElectionImage
);
router.get("/elections", protect, validate(validators.adminElectionList), getAdminElectionsByStatus);
router.get("/elections/:electionId", protect, getAdminElectionById);
router.get("/elections/:electionId/categories", protect, getAdminElectionCategories);
router.get("/elections/:electionId/aspirants", protect, getAdminElectionAspirants);
router.post(
  "/elections",
  createRateLimiter({ key: "admin-create-election", windowMs: 10 * 60 * 1000, max: 20 }),
  protect,
  validate(validators.adminElectionCreate),
  createAdminElection
);
router.put("/elections/:electionId", protect, updateAdminElection);
router.patch("/elections/:electionId/schedule", protect, scheduleAdminElection);
router.delete("/elections/:electionId", protect, deleteAdminElection);
router.get("/reports/elections/:electionId", protect, getAdminElectionReport);
router.get("/reports/:schoolId", protect, getAdminReports);
router.get("/activity/:schoolId", protect, getAdminActivity);

export default router;
