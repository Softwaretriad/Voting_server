import mongoose from "mongoose";

const VoteSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    electionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Election",
      required: true,
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    categoryKey: { type: String, required: true, trim: true, index: true },
    aspirantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Aspirant",
      required: true,
      index: true,
    },
    voterType: {
      type: String,
      enum: ["student", "ec"],
      required: true,
    },
    voterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
    },
    ecUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
    },
    candidate: { type: String, default: "" },
    legacyTimestamp: { type: Date, default: null },
  },
  { timestamps: true }
);

VoteSchema.index(
  { electionId: 1, voterId: 1, categoryKey: 1 },
  { unique: true, name: "unique_vote_per_voter_category" }
);
VoteSchema.index({ electionId: 1, categoryKey: 1, createdAt: 1 });
VoteSchema.index({ electionId: 1, voterType: 1, voterId: 1 });
VoteSchema.index({ schoolId: 1, voterId: 1, createdAt: -1 });
VoteSchema.index({ schoolId: 1, electionId: 1, createdAt: -1 });
VoteSchema.index({ aspirantId: 1, electionId: 1 });

export default mongoose.models.Vote || mongoose.model("Vote", VoteSchema);
