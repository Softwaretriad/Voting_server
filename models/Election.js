import mongoose from "mongoose";

const ElectionSchema = new mongoose.Schema({
  ecId: { type: mongoose.Schema.Types.ObjectId, ref: "ECUser", required: true },
  title: { type: String, required: true },
  startTime: Date,
  endTime: Date,
  status: { type: String, enum: ["pending", "active", "ended"], default: "pending" }
});

export default mongoose.model("Election", ElectionSchema);
