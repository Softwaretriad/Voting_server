import dotenv from "dotenv";
import {
  processElectionLifecycle,
  startElectionResultsProcessor,
} from "../utils/electionResultsProcessor.js";
import { connectMongo } from "../utils/mongoConnection.js";
import { markWorkerStarted, markWorkerSuccess } from "../utils/workerHeartbeat.js";

dotenv.config();

const workerName = "election-lifecycle";
const intervalMs = Number(process.env.ELECTION_LIFECYCLE_INTERVAL_MS || 60000);

const startWorker = async () => {
  await connectMongo();
  await markWorkerStarted({ workerName, intervalMs });
  console.log("Election lifecycle worker connected to MongoDB");

  const startedAt = Date.now();
  const firstRun = await processElectionLifecycle();
  await markWorkerSuccess({
    workerName,
    durationMs: Date.now() - startedAt,
    intervalMs,
    result: firstRun,
  });
  console.log("Election lifecycle first run:", firstRun);

  startElectionResultsProcessor();
};

startWorker().catch((error) => {
  console.error("Election lifecycle worker failed:", error);
  process.exit(1);
});
