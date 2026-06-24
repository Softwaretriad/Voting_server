import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const confirmed =
  process.env.RETIRED_RESULT_EMAIL_CLEANUP_CONFIRM ===
  "delete-retired-result-email-data";

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  const collectionNames = new Set(collections.map((entry) => entry.name));
  const emailJobCollectionName = ["emailjobs", "emailJobs"].find((name) =>
    collectionNames.has(name)
  );

  const legacyElectionFilter = {
    $or: [
      { resultsEmailSentAt: { $exists: true } },
      { resultsEmailQueuedAt: { $exists: true } },
      { resultsEmailSummary: { $exists: true } },
    ],
  };

  const summary = {
    electionsWithLegacyEmailFields: await db
      .collection("elections")
      .countDocuments(legacyElectionFilter),
    queuedEmailJobs: emailJobCollectionName
      ? await db.collection(emailJobCollectionName).countDocuments({})
      : 0,
  };

  console.log("Retired result email cleanup summary:", summary);

  if (!confirmed) {
    console.log(
      "Dry run only. Set RETIRED_RESULT_EMAIL_CLEANUP_CONFIRM=delete-retired-result-email-data to delete."
    );
    await mongoose.disconnect();
    return;
  }

  await db.collection("elections").updateMany(legacyElectionFilter, {
    $unset: {
      resultsEmailSentAt: "",
      resultsEmailQueuedAt: "",
      resultsEmailSummary: "",
    },
  });

  if (emailJobCollectionName) {
    await db.collection(emailJobCollectionName).deleteMany({});
  }
  if (collectionNames.has("workerheartbeats")) {
    await db.collection("workerheartbeats").deleteMany({ workerName: "email" });
  }

  console.log("Removed retired result-email data.");
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Retired result email cleanup failed:", error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
