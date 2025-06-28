import mongoose from "mongoose";

const ElectionSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
  title: { type: String, required: true },
  startTime: { type: Date },
  endTime: { type: Date, required: true },
  status: { type: String, enum: ["pending", "active", "ended"], default: "pending" },
  candidates: [
    {
      name: { type: String, required: true },
      position: { type: String, required: true }
    }
  ],
  votes: [
    {
      candidate: String,
      voterId: { type: mongoose.Schema.Types.ObjectId, ref: "Voter" },
      timestamp: { type: Date, default: Date.now }
    }
  ]
});

export default mongoose.model("Election", ElectionSchema);
