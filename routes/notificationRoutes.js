import express from "express";
import {
  getStudentNotifications,
  markStudentNotificationAsRead,
} from "../controllers/notificationController.js";
import { protectStudent } from "../middleware/authStudent.js";

const router = express.Router();

router.get("/:userId", protectStudent, getStudentNotifications);
router.patch("/:userId/:notificationId/read", protectStudent, markStudentNotificationAsRead);

export default router;
