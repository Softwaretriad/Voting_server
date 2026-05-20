import express from "express";
import {
  deleteApnsToken,
  deletePushToken,
  registerApnsToken,
  registerPushToken,
} from "../controllers/deviceController.js";
import { protectAnyUser } from "../middleware/authAnyUser.js";
import { validate, validators } from "../middleware/validate.js";

const router = express.Router();

router.post(
  "/push-tokens",
  protectAnyUser,
  validate(validators.registerDeviceToken),
  registerPushToken
);
router.delete("/push-tokens/:token", protectAnyUser, deletePushToken);
router.post(
  "/apns-tokens",
  protectAnyUser,
  validate(validators.registerDeviceToken),
  registerApnsToken
);
router.delete("/apns-tokens/:token", protectAnyUser, deleteApnsToken);

export default router;
