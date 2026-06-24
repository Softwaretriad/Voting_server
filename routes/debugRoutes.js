import express from "express";
import { sendTestPushNotification } from "../controllers/debugController.js";
import { protectAnyUser } from "../middleware/authAnyUser.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { noStore } from "../middleware/noStore.js";

const router = express.Router();
router.use(noStore);

router.post(
  "/test-push",
  createRateLimiter({ key: "debug-test-push", windowMs: 10 * 60 * 1000, max: 10 }),
  protectAnyUser,
  sendTestPushNotification
);

export default router;
