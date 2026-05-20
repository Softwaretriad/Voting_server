import express from "express";
import { sendTestPushNotification } from "../controllers/debugController.js";
import { protectAnyUser } from "../middleware/authAnyUser.js";

const router = express.Router();

router.post("/test-push", protectAnyUser, sendTestPushNotification);

export default router;
