import dotenv from "dotenv";
import { processQueuedVoteSideEffectBatch } from "../utils/voteSideEffectQueue.js";
import { connectMongo, ensureMongoConnected } from "../utils/mongoConnection.js";
import {
  markWorkerFailure,
  markWorkerStarted,
  markWorkerSuccess,
} from "../utils/workerHeartbeat.js";

dotenv.config();

const workerName = "vote-side-effects";
const intervalMs = Number(process.env.VOTE_SIDE_EFFECT_WORKER_INTERVAL_MS || 1000);
const batchSize = Number(process.env.VOTE_SIDE_EFFECT_WORKER_BATCH_SIZE || 25);

const runBatch = async () => {
  const startedAt = Date.now();
  await ensureMongoConnected();
  try {
    const results = await processQueuedVoteSideEffectBatch({ batchSize });
    await markWorkerSuccess({
      workerName,
      durationMs: Date.now() - startedAt,
      intervalMs,
      result: {
        processed: results.length,
        completed: results.filter((result) => result.status === "completed").length,
        failed: results.filter((result) => result.status === "failed").length,
        requeued: results.filter((result) => result.status === "queued").length,
      },
    });
    if (results.length > 0) {
      console.log("Processed vote side effect jobs:", results);
    }
  } catch (error) {
    await markWorkerFailure({
      workerName,
      durationMs: Date.now() - startedAt,
      intervalMs,
      error,
    });
    throw error;
  }
};

const startWorker = async () => {
  await connectMongo();
  await markWorkerStarted({ workerName, intervalMs });
  console.log("Vote side effect worker connected to MongoDB");

  await runBatch();
  setInterval(() => {
    runBatch().catch((error) => {
      console.error("Vote side effect worker batch failed:", error.message);
    });
  }, intervalMs);
};

startWorker().catch((error) => {
  console.error("Vote side effect worker failed:", error);
  process.exit(1);
});
