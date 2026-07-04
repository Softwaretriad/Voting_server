import mongoose from "mongoose";

const PlanUpdateRequestSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolAdmin",
      required: true,
    },
    currentPlan: { type: String, required: true, trim: true },
    targetPlan: { type: String, required: true, trim: true },
    currentElectionType: { type: String, required: true, trim: true },
    targetElectionType: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending_review", "approved", "rejected", "closed"],
      default: "pending_review",
      index: true,
    },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, trim: true, default: "" },
    reviewNote: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

PlanUpdateRequestSchema.index({ schoolId: 1, status: 1, createdAt: -1 });

export default mongoose.models.PlanUpdateRequest ||
  mongoose.model("PlanUpdateRequest", PlanUpdateRequestSchema);
