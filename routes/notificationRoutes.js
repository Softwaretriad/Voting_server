import express from "express";
import { getNotifications } from "../controllers/notificationController.js";
import { protectStudent } from "../middleware/authStudent.js";

const router = express.Router();

router.get("/:userId", protectStudent, getNotifications);

export default router;
