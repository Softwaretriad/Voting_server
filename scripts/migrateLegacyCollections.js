import dotenv from "dotenv";
import mongoose from "mongoose";
import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import Voter from "../models/Voter.js";

dotenv.config();

const buildLegacyAspirant = (doc) => ({
  name: String(doc.name || "Legacy Aspirant").trim(),
  studentId: String(doc.studentId || `LEGACY-${doc._id}`).trim(),
  programmeOfStudy: String(doc.programmeOfStudy || "Unknown").trim(),
  level: String(doc.level || doc.currentYearOfStudy || "Unknown").trim(),
  faculty: String(doc.faculty || doc.department || "Unknown").trim(),
  electoralCategory: String(doc.electoralCategory || doc.position || "General").trim(),
  schoolId: doc.schoolId || null,
  electionId: doc.electionId || null,
  categoryId: doc.categoryId || null,
  imageUrl: String(doc.imageUrl || "").trim(),
  title: String(doc.title || "Legacy Election").trim(),
  voteCount: Number(doc.voteCount || 0),
});

const migrateLegacyCandidates = async () => {
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  const hasLegacyCandidates = collections.some((item) => item.name === "candidates");

  if (!hasLegacyCandidates) {
    return { found: 0, migrated: 0, dropped: false };
  }

  const legacyCandidates = await db.collection("candidates").find({}).toArray();
  if (legacyCandidates.length === 0) {
    await db.collection("candidates").drop().catch(() => {});
    return { found: 0, migrated: 0, dropped: true };
  }

  const ops = legacyCandidates
    .map((doc) => buildLegacyAspirant(doc))
    .filter((doc) => doc.schoolId)
    .map((doc) => ({
      updateOne: {
        filter: {
          schoolId: doc.schoolId,
          electionId: doc.electionId,
          studentId: doc.studentId,
          electoralCategory: doc.electoralCategory,
          title: doc.title,
        },
        update: { $set: doc },
        upsert: true,
      },
    }));

  if (ops.length > 0) {
    await Aspirant.bulkWrite(ops, { ordered: false });
  }

  await db.collection("candidates").drop().catch(() => {});

  return {
    found: legacyCandidates.length,
    migrated: ops.length,
    dropped: true,
  };
};

const migrateLegacyVoters = async () => {
  const legacyVoters = await mongoose.connection.db.collection("voters").find({}).toArray();
  if (legacyVoters.length === 0) {
    return { normalized: 0 };
  }

  const ops = legacyVoters
    .filter((doc) => doc.schoolId)
    .map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            schoolId: doc.schoolId,
            electionId: doc.electionId || null,
            name: String(doc.name || doc.email || "Legacy Voter").trim(),
            studentId: String(doc.studentId || `LEGACY-${doc._id}`).trim(),
            programmeOfStudy: String(doc.programmeOfStudy || "").trim(),
            level: String(doc.level || "").trim(),
            faculty: String(doc.faculty || doc.department || "").trim(),
            email: String(doc.email || "").trim().toLowerCase(),
            source: "migration",
          },
          $unset: {
            ecId: "",
            hasVoted: "",
            otp: "",
            otpExpires: "",
            isVerified: "",
            hasVotedPositions: "",
            department: "",
          },
        },
      },
    }));

  if (ops.length > 0) {
    await mongoose.connection.db.collection("voters").bulkWrite(ops, { ordered: false });
  }

  return { normalized: ops.length };
};

const backfillElectionEligibleVoters = async () => {
  const elections = await Election.find({
    "eligibleVoters.0": { $exists: true },
  }).select("_id schoolId eligibleVoters");

  let inserted = 0;

  for (const election of elections) {
    const ops = (election.eligibleVoters || [])
      .filter((voter) => voter.name && voter.studentId)
      .map((voter) => ({
        updateOne: {
          filter: {
            schoolId: election.schoolId,
            electionId: election._id,
            studentId: voter.studentId,
          },
          update: {
            $set: {
              schoolId: election.schoolId,
              electionId: election._id,
              name: String(voter.name || "").trim(),
              studentId: String(voter.studentId || "").trim(),
              programmeOfStudy: String(voter.programmeOfStudy || "").trim(),
              level: String(voter.level || "").trim(),
              faculty: String(voter.faculty || "").trim(),
              email: "",
              source: "migration",
            },
          },
          upsert: true,
        },
      }));

    if (ops.length > 0) {
      await Voter.bulkWrite(ops, { ordered: false });
      inserted += ops.length;
    }
  }

  return { electionsScanned: elections.length, voterRowsUpserted: inserted };
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const [candidateResult, voterResult, backfillResult] = await Promise.all([
    migrateLegacyCandidates(),
    migrateLegacyVoters(),
    backfillElectionEligibleVoters(),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        candidateResult,
        voterResult,
        backfillResult,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
