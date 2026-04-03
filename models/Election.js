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
  startTime: { type: Date },
  endTime: { type: Date, required: true },
  status: {
    type: String,
    enum: ["pending", "draft", "scheduled", "active", "ended", "closed"],
    default: "draft",
  },
  voterListUrl: { type: String, default: "" },
  aspirantListUrl: { type: String, default: "" },
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
      aspirantId: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate" },
      electionId: { type: mongoose.Schema.Types.ObjectId, ref: "Election" },
      categoryId: { type: mongoose.Schema.Types.ObjectId },
      voterId: { type: mongoose.Schema.Types.ObjectId, ref: "Voter" },
      studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
      timestamp: { type: Date, default: Date.now },
    },
  ],
  resultsEmailSentAt: { type: Date, default: null },
  resultsEmailSummary: {
    recipientsTargeted: { type: Number, default: 0 },
    recipientsSent: { type: Number, default: 0 },
    failedRecipients: [
      {
        studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student" },
        email: String,
        attempts: Number,
        error: String,
      },
    ],
  },
});

export default mongoose.model("Election", ElectionSchema);
