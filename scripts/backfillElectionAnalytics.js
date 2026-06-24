import dotenv from "dotenv";
import mongoose from "mongoose";
import Election from "../models/Election.js";
import { refreshElectionAnalyticsSnapshot } from "../utils/electionAnalytics.js";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const cursor = Election.find({}).cursor();
  let refreshed = 0;

  for await (const election of cursor) {
    await refreshElectionAnalyticsSnapshot(election);
    refreshed += 1;
    console.log(`Refreshed analytics snapshot for ${election._id}`);
  }

  console.log({ refreshed });
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Analytics backfill failed:", error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
