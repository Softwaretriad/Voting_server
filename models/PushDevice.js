import mongoose from "mongoose";
import { EC_ROLE } from "../utils/ecRole.js";

const PushDeviceSchema = new mongoose.Schema(
  {
    recipientType: {
      type: String,
      enum: ["student", EC_ROLE],
      required: true,
      index: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      default: null,
      index: true,
    },
    provider: {
      type: String,
      enum: ["fcm", "apns"],
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ["android", "ios", "web", "unknown"],
      default: "unknown",
    },
    deviceId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    notificationsEnabled: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

PushDeviceSchema.index(
  { provider: 1, token: 1 },
  {
    unique: true,
  }
);

PushDeviceSchema.index({ recipientType: 1, recipientId: 1, provider: 1, isActive: 1 });

export default mongoose.model("PushDevice", PushDeviceSchema);
