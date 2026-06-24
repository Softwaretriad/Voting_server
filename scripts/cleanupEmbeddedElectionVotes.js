import dotenv from "dotenv";
import mongoose from "mongoose";
import Election from "../models/Election.js";
import Vote from "../models/Vote.js";

dotenv.config();

const confirmed =
  process.env.EMBEDDED_VOTES_CLEANUP_CONFIRM === "unset-embedded-election-votes" ||
  process.env.CLEANUP_CONFIRM === "unset-embedded-election-votes";
const requireBackfill = process.env.SKIP_EMBEDDED_VOTE_BACKFILL_CHECK !== "true";

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const elections = await Election.find({ "votes.0": { $exists: true } })
    .select("_id title schoolId votes")
    .lean();

  const summary = {
    electionsWithEmbeddedVotes: elections.length,
    embeddedVotes: elections.reduce((sum, election) => sum + (election.votes?.length || 0), 0),
    missingBackfill: [],
  };

  if (requireBackfill) {
    for (const election of elections) {
      const storedCount = await Vote.countDocuments({ electionId: election._id });
      if (storedCount < (election.votes?.length || 0)) {
        summary.missingBackfill.push({
          electionId: election._id.toString(),
          title: election.title,
          embeddedVotes: election.votes?.length || 0,
          storedVotes: storedCount,
        });
      }
    }
  }

  console.log("Embedded vote cleanup summary:", summary);

  if (summary.missingBackfill.length > 0) {
    console.log(
      "Backfill check failed. Run npm run migrate:votes first, or set SKIP_EMBEDDED_VOTE_BACKFILL_CHECK=true if you know what you are doing."
    );
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  if (!confirmed) {
    console.log(
      "Dry run only. Set EMBEDDED_VOTES_CLEANUP_CONFIRM=unset-embedded-election-votes to remove embedded votes."
    );
    await mongoose.disconnect();
    return;
  }

  const result = await Election.updateMany(
    { "votes.0": { $exists: true } },
    { $unset: { votes: "" } }
  );

  console.log("Unset embedded Election.votes[]:", {
    matched: result.matchedCount,
    modified: result.modifiedCount,
  });

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Embedded vote cleanup failed:", error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
