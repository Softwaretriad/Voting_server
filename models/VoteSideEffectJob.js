import mongoose from "mongoose";

const VoteSideEffectJobSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["queued", "processing", "completed", "failed"],
      default: "queued",
      index: true,
    },
    voteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vote",
      required: true,
    },
    electionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Election",
      required: true,
      index: true,
    },
    aspirantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Aspirant",
      required: true,
    },
    voterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    voterType: {
      type: String,
      enum: ["student", "ec"],
      default: "student",
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 3 },
    countersApplied: { type: Boolean, default: false },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    processedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
  },
  { timestamps: true }
);

VoteSideEffectJobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
VoteSideEffectJobSchema.index({ voteId: 1 }, { unique: true });
VoteSideEffectJobSchema.index({ electionId: 1, status: 1 });

export default mongoose.models.VoteSideEffectJob ||
  mongoose.model("VoteSideEffectJob", VoteSideEffectJobSchema);
