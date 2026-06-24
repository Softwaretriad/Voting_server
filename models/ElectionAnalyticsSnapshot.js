import mongoose from "mongoose";

const ElectionAnalyticsSnapshotSchema = new mongoose.Schema(
  {
    electionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Election",
      required: true,
      unique: true,
      index: true,
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    status: { type: String, default: "", index: true },
    totalVotes: { type: Number, default: 0 },
    uniqueVoters: { type: Number, default: 0 },
    turnoutPercentage: { type: Number, default: 0 },
    registeredVoters: { type: Number, default: 0 },
    accreditedVoters: { type: Number, default: 0 },
    categoryTotals: { type: mongoose.Schema.Types.Mixed, default: {} },
    categoryLeaders: { type: [mongoose.Schema.Types.Mixed], default: [] },
    turnoutTrend: { type: [mongoose.Schema.Types.Mixed], default: [] },
    voteDistribution: { type: [mongoose.Schema.Types.Mixed], default: [] },
    facultyVoteStatus: { type: [mongoose.Schema.Types.Mixed], default: [] },
    refreshedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

ElectionAnalyticsSnapshotSchema.index({ schoolId: 1, status: 1, refreshedAt: -1 });

export default mongoose.models.ElectionAnalyticsSnapshot ||
  mongoose.model("ElectionAnalyticsSnapshot", ElectionAnalyticsSnapshotSchema);
