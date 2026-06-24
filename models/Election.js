import mongoose from "mongoose";

const ElectionCategorySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subTitle: { type: String, trim: true, default: "" },
    imageUrl: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

const ElectionSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  subTitle: { type: String, default: "" },
  imageUrl: { type: String, default: "" },
  startTime: { type: Date, default: null },
  endTime: { type: Date, default: null },
  status: {
    type: String,
    enum: ["pending", "draft", "scheduled", "active", "ended", "closed"],
    default: "draft",
  },
  voterListUrl: { type: String, default: "" },
  aspirantListUrl: { type: String, default: "" },
  eligibleVoters: {
    type: [
      {
        name: { type: String, default: "" },
        studentId: { type: String, default: "" },
        programmeOfStudy: { type: String, default: "" },
        level: { type: String, default: "" },
        faculty: { type: String, default: "" },
      },
    ],
    default: [],
  },
  categories: { type: [ElectionCategorySchema], default: [] },
  candidates: [
    {
      name: { type: String, required: true },
      position: { type: String, required: true },
    },
  ],
  votes: [
    {
      candidate: String,
      aspirantId: { type: mongoose.Schema.Types.ObjectId, ref: "Aspirant" },
      electionId: { type: mongoose.Schema.Types.ObjectId, ref: "Election" },
      categoryId: { type: mongoose.Schema.Types.ObjectId },
      voterId: { type: mongoose.Schema.Types.ObjectId, ref: "Voter" },
      studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
      timestamp: { type: Date, default: Date.now },
    },
  ],
  totalVotes: { type: Number, default: 0 },
  notifications: {
    startingSoonSentAt: { type: Date, default: null },
    closingSoonSentAt: { type: Date, default: null },
    liveSentAt: { type: Date, default: null },
    closedSentAt: { type: Date, default: null },
    resultsPublishedSentAt: { type: Date, default: null },
    turnoutMilestonesSent: { type: [Number], default: [] },
  },
});

ElectionSchema.index({ schoolId: 1, status: 1, startTime: 1 });
ElectionSchema.index({ schoolId: 1, status: 1, createdAt: -1 });

export default mongoose.model("Election", ElectionSchema);
