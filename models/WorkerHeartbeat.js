import mongoose from "mongoose";

const WorkerHeartbeatSchema = new mongoose.Schema(
  {
    workerName: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["starting", "ok", "error"],
      default: "starting",
      index: true,
    },
    lastStartedAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    lastFailureAt: { type: Date, default: null },
    lastDurationMs: { type: Number, default: 0 },
    lastResult: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastError: { type: String, default: "" },
    intervalMs: { type: Number, default: 0 },
    pid: { type: Number, default: null },
    hostname: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.models.WorkerHeartbeat ||
  mongoose.model("WorkerHeartbeat", WorkerHeartbeatSchema);
