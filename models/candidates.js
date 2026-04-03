import mongoose from "mongoose";

const CandidateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  position: { type: String, required: true },
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
  electionId: { type: mongoose.Schema.Types.ObjectId, ref: "Election", default: null },
  categoryId: { type: mongoose.Schema.Types.ObjectId, default: null },
  department: { type: String, default: "" },
  imageUrl: { type: String, default: "" },
  title: { type: String, required: true },
  voteCount: { type: Number, default: 0 },
});

export default mongoose.model("Candidate", CandidateSchema);
