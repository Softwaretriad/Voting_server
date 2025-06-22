import mongoose from "mongoose";

const VoterSchema = new mongoose.Schema({
  ecId: { type: mongoose.Schema.Types.ObjectId, ref: "ECUser", required: true },
  name: String,
  email: { type: String, required: true },
  studentId: String,
  hasVoted: { type: Boolean, default: false }
});

export default mongoose.model("Voter", VoterSchema);
