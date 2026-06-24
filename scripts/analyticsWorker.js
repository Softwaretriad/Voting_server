import dotenv from "dotenv";
import { refreshActiveElectionAnalyticsSnapshots } from "../utils/electionAnalytics.js";
import { withDistributedJobLock } from "../utils/jobLock.js";
import { connectMongo, ensureMongoConnected } from "../utils/mongoConnection.js";
import {
  markWorkerFailure,
  markWorkerStarted,
  markWorkerSuccess,
} from "../utils/workerHeartbeat.js";

dotenv.config();

const workerName = "analytics";
const intervalMs = Number(process.env.ANALYTICS_WORKER_INTERVAL_MS || 5000);
const batchSize = Number(process.env.ANALYTICS_WORKER_BATCH_SIZE || 100);

const runBatch = async () => {
  const startedAt = Date.now();
  await ensureMongoConnected();
  try {
    const { acquired, result } = await withDistributedJobLock({
      key: "analytics-snapshot-refresh",
      ttlMs: Math.max(intervalMs * 2, 10000),
      task: async () => refreshActiveElectionAnalyticsSnapshots({ limit: batchSize }),
    });

    await markWorkerSuccess({
      workerName,
      durationMs: Date.now() - startedAt,
      intervalMs,
      result: acquired ? result : { skipped: "lock held by another worker" },
    });

    if (!acquired) {
      return;
    }

    if (result.refreshedCount > 0) {
      console.log("Analytics snapshots refreshed:", result);
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
  console.log("Analytics worker connected to MongoDB");

  await runBatch();
  setInterval(() => {
    runBatch().catch((error) => {
      console.error("Analytics worker batch failed:", error.message);
    });
  }, intervalMs);
};

startWorker().catch((error) => {
  console.error("Analytics worker failed:", error);
  process.exit(1);
});
