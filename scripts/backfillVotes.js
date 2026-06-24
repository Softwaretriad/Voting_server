import dotenv from "dotenv";
import mongoose from "mongoose";
import Election from "../models/Election.js";
import Vote from "../models/Vote.js";

dotenv.config();

const toCategoryKey = (vote) => String(vote.categoryId || "");

const migrateElectionVotes = async (election) => {
  let inserted = 0;
  let skipped = 0;

  for (const vote of election.votes || []) {
    const voterId = vote.studentId || vote.adminId || vote.ecUserId || vote.voterId;
    const voterType = vote.studentId ? "student" : "ec";
    const categoryKey = toCategoryKey(vote);

    if (!voterId || !categoryKey || !vote.aspirantId) {
      skipped += 1;
      continue;
    }

    try {
      const result = await Vote.updateOne(
        {
          electionId: election._id,
          voterId,
          categoryKey,
        },
        {
          $setOnInsert: {
            schoolId: election.schoolId,
            electionId: election._id,
            categoryId: vote.categoryId || null,
            categoryKey,
            aspirantId: vote.aspirantId,
            voterType,
            voterId,
            studentId: vote.studentId || null,
            ecUserId: vote.adminId || vote.ecUserId || null,
            candidate: vote.candidate || "",
            legacyTimestamp: vote.timestamp || election.createdAt || null,
          },
        },
        { upsert: true }
      );
      if (result.upsertedCount > 0) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      if (error.code === 11000) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }

  if ((election.votes || []).length > 0) {
    const voteCount = await Vote.countDocuments({ electionId: election._id });
    await Election.updateOne({ _id: election._id }, { $set: { totalVotes: voteCount } });
  }

  return { inserted, skipped };
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const cursor = Election.find({ "votes.0": { $exists: true } }).cursor();
  let electionsScanned = 0;
  let inserted = 0;
  let skipped = 0;

  for await (const election of cursor) {
    const result = await migrateElectionVotes(election);
    electionsScanned += 1;
    inserted += result.inserted;
    skipped += result.skipped;
    console.log(
      `Backfilled ${election._id}: inserted=${result.inserted}, skipped=${result.skipped}`
    );
  }

  console.log({ electionsScanned, inserted, skipped });
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Vote backfill failed:", error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
