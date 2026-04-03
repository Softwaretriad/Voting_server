import mongoose from "mongoose";

const ActivityLogSchema = new mongoose.Schema(
  {
    actorType: { type: String, enum: ["student", "admin", "system"], required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", default: null },
    action: { type: String, required: true, trim: true },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("ActivityLog", ActivityLogSchema);
