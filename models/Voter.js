import mongoose from "mongoose";

const VoterSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    electionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Election",
      default: null,
    },
    name: { type: String, required: true, trim: true },
    studentId: { type: String, required: true, trim: true },
    programmeOfStudy: { type: String, default: "", trim: true },
    level: { type: String, default: "", trim: true },
    faculty: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    source: {
      type: String,
      enum: ["upload", "migration"],
      default: "upload",
    },
  },
  { timestamps: true }
);

VoterSchema.index({ electionId: 1, schoolId: 1, studentId: 1 });
VoterSchema.index({ schoolId: 1, studentId: 1 });

export default mongoose.model("Voter", VoterSchema);
