import express from "express";
import { protect } from "../middleware/authEC.js";
import {
  castAdminVote as castEcVote,
  getAdminVoteHistory as getEcVoteHistory,
} from "../controllers/adminVoteController.js";
import {
  createAdminElection as createEcElection,
  deleteAdminElection as deleteEcElection,
  getAdminElectionById as getEcElectionById,
  getAdminElectionAspirants as getEcElectionAspirants,
  getAdminElectionCategories as getEcElectionCategories,
  getAdminElectionsByStatus as getEcElectionsByStatus,
  scheduleAdminElection as scheduleEcElection,
  updateAdminElection as updateEcElection,
} from "../controllers/adminElectionController.js";
import {
  getAdminActivity as getEcActivity,
  getAdminDashboard as getEcDashboard,
  getAdminElectionMonitor as getEcElectionMonitor,
  getAdminElectionReport as getEcElectionReport,
  getAdminReports as getEcReports,
} from "../controllers/adminInsightsController.js";
import {
  getAdminNotificationPreferences as getEcNotificationPreferences,
  getAdminNotifications as getEcNotifications,
  markAllAdminNotificationsAsRead as markAllEcNotificationsAsRead,
  markAdminNotificationAsRead as markEcNotificationAsRead,
  updateAdminNotificationPreferences as updateEcNotificationPreferences,
} from "../controllers/notificationController.js";
import {
  handleImageUploadError,
  uploadAdminImage as uploadEcImage,
  uploadElectionImage,
} from "../controllers/uploadController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { uploadImage } from "../middleware/uploadImage.js";
import { validate, validators } from "../middleware/validate.js";
import { noStore } from "../middleware/noStore.js";
import { rejectMongoOperatorKeys } from "../middleware/noSqlProtection.js";

const router = express.Router();
router.use(noStore);

router.post("/votes/cast", protect, validate(validators.castEcVote), castEcVote);
router.get("/votes/history/:ecUserId", protect, getEcVoteHistory);
router.get("/notifications/:ecUserId", protect, getEcNotifications);
router.patch("/notifications/:ecUserId/read-all", protect, markAllEcNotificationsAsRead);
router.patch(
  "/notifications/:ecUserId/:notificationId/read",
  protect,
  markEcNotificationAsRead
);
router.get("/:ecUserId/notification-preferences", protect, getEcNotificationPreferences);
router.patch(
  "/:ecUserId/notification-preferences",
  protect,
  validate(validators.notificationPreferences),
  updateEcNotificationPreferences
);

router.get("/dashboard/:schoolId", protect, getEcDashboard);
router.get("/monitor/elections/:electionId", protect, getEcElectionMonitor);
const imageUploadRateLimit = createRateLimiter({
  key: "ec-image-upload",
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: "Too many image uploads. Please try again later.",
});
router.post(
  "/uploads/images",
  protect,
  imageUploadRateLimit,
  uploadImage,
  handleImageUploadError,
  rejectMongoOperatorKeys,
  uploadEcImage
);
router.post(
  "/uploads/election-images",
  protect,
  imageUploadRateLimit,
  uploadImage,
  handleImageUploadError,
  rejectMongoOperatorKeys,
  uploadElectionImage
);
router.get("/elections", protect, validate(validators.ecElectionList), getEcElectionsByStatus);
router.get("/elections/:electionId", protect, getEcElectionById);
router.get("/elections/:electionId/categories", protect, getEcElectionCategories);
router.get("/elections/:electionId/aspirants", protect, getEcElectionAspirants);
router.post(
  "/elections",
  createRateLimiter({ key: "ec-create-election", windowMs: 10 * 60 * 1000, max: 20 }),
  protect,
  validate(validators.ecElectionCreate),
  createEcElection
);
const electionMutationRateLimit = createRateLimiter({
  key: "ec-election-mutation",
  windowMs: 10 * 60 * 1000,
  max: 40,
});
router.put(
  "/elections/:electionId",
  protect,
  electionMutationRateLimit,
  updateEcElection
);
router.patch(
  "/elections/:electionId/schedule",
  protect,
  electionMutationRateLimit,
  scheduleEcElection
);
router.delete(
  "/elections/:electionId",
  protect,
  electionMutationRateLimit,
  deleteEcElection
);
router.get("/reports/elections/:electionId", protect, getEcElectionReport);
router.get("/reports/:schoolId", protect, getEcReports);
router.get("/activity/:schoolId", protect, getEcActivity);

export default router;
