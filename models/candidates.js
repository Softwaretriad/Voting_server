// models/Candidate.js
import mongoose from "mongoose";

const CandidateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  position: { type: String, required: true },
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
  title: { type: String, required: true },
  voteCount: { type: Number, default: 0 } 
});

export default mongoose.model("Candidate", CandidateSchema);
