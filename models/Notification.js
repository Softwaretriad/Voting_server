import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    recipientType: {
      type: String,
      enum: ["student", "admin"],
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
      index: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ECUser",
      default: null,
      index: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      default: null,
      index: true,
    },
    type: { type: String, required: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    priority: {
      type: String,
      enum: ["low", "normal", "high"],
      default: "normal",
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Automatically remove notifications about two minutes after they are marked as read.
NotificationSchema.index({ readAt: 1 }, { expireAfterSeconds: 120 });

export default mongoose.model("Notification", NotificationSchema);
