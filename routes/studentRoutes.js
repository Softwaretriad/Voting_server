import express from "express";
import {
  changeStudentEmail,
  deleteStudentAccount,
  getStudentProfile,
  getStudentVoteHistory,
  updateStudentProfile,
} from "../controllers/studentController.js";
import {
  getStudentNotificationPreferences,
  updateStudentNotificationPreferences,
} from "../controllers/notificationController.js";
import { setVotingPin } from "../controllers/studentVoteController.js";
import { protectDeleteAccount } from "../middleware/authDeleteAccount.js";
import { protectStudent } from "../middleware/authStudent.js";
import { validate, validators } from "../middleware/validate.js";
import { noStore } from "../middleware/noStore.js";

const router = express.Router();
router.use(noStore);

router.get("/:userId", protectStudent, getStudentProfile);
router.patch(
  "/:userId",
  protectStudent,
  validate(validators.updateStudentProfile),
  updateStudentProfile
);
router.patch(
  "/:userId/email",
  protectStudent,
  validate(validators.changeStudentEmail),
  changeStudentEmail
);
router.post(
  "/:userId/voting-pin",
  protectStudent,
  validate(validators.setVotingPin),
  setVotingPin
);
router.delete(
  "/:userId",
  protectDeleteAccount,
  validate(validators.deleteStudentAccount),
  deleteStudentAccount
);
router.get("/:userId/vote-history", protectStudent, getStudentVoteHistory);
router.get(
  "/:userId/notification-preferences",
  protectStudent,
  getStudentNotificationPreferences
);
router.patch(
  "/:userId/notification-preferences",
  protectStudent,
  validate(validators.notificationPreferences),
  updateStudentNotificationPreferences
);

export default router;
