import mongoose from "mongoose";

const VoterSchema = new mongoose.Schema({
  ecId: { type: mongoose.Schema.Types.ObjectId, ref: "ECUser", required: true },
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
  name: String,
  email: { type: String, required: true },
  studentId: String,
  hasVoted: { type: Boolean, default: false },
  otp: String,
  otpExpires: Date,
  isVerified: { type: Boolean, default: false }

});

export default mongoose.model("Voter", VoterSchema);
