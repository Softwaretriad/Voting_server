import os from "os";
import WorkerHeartbeat from "../models/WorkerHeartbeat.js";

const hostname = os.hostname();

const updateWorkerHeartbeat = async (workerName, update) => {
  if (!workerName) {
    return null;
  }

  return WorkerHeartbeat.findOneAndUpdate(
    { workerName },
    {
      $set: {
        ...update,
        pid: process.pid,
        hostname,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

export const markWorkerStarted = async ({ workerName, intervalMs = 0 }) =>
  updateWorkerHeartbeat(workerName, {
    status: "starting",
    lastStartedAt: new Date(),
    intervalMs,
    lastError: "",
  });

export const markWorkerSuccess = async ({
  workerName,
  durationMs = 0,
  result = {},
  intervalMs = 0,
}) =>
  updateWorkerHeartbeat(workerName, {
    status: "ok",
    lastSuccessAt: new Date(),
    lastDurationMs: Math.round(durationMs),
    lastResult: result,
    intervalMs,
    lastError: "",
  });

export const markWorkerFailure = async ({
  workerName,
  durationMs = 0,
  error,
  intervalMs = 0,
}) =>
  updateWorkerHeartbeat(workerName, {
    status: "error",
    lastFailureAt: new Date(),
    lastDurationMs: Math.round(durationMs),
    lastError: error?.message || String(error || "Worker failed"),
    intervalMs,
  });
