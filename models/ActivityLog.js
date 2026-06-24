import mongoose from "mongoose";
import { EC_ROLE } from "../utils/ecRole.js";

const ActivityLogSchema = new mongoose.Schema(
  {
    actorType: { type: String, enum: ["student", EC_ROLE, "system"], required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    actorName: { type: String, trim: true, default: "" },
    actorFirstName: { type: String, trim: true, default: "" },
    actorLastName: { type: String, trim: true, default: "" },
    actorEmail: { type: String, trim: true, lowercase: true, default: "" },
    actorStudentId: { type: String, trim: true, default: "" },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", default: null },
    action: { type: String, required: true, trim: true },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);

ActivityLogSchema.index({ schoolId: 1, actorType: 1, createdAt: -1 });
ActivityLogSchema.index({ actorId: 1, createdAt: -1 });

export default mongoose.model("ActivityLog", ActivityLogSchema);
