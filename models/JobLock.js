import mongoose from "mongoose";

const JobLockSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    owner: { type: String, required: true, trim: true },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

export default mongoose.models.JobLock || mongoose.model("JobLock", JobLockSchema);
