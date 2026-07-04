import dotenv from "dotenv";
import mongoose from "mongoose";
import Aspirant from "../models/Aspirant.js";

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

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const [candidateResult] = await Promise.all([
    migrateLegacyCandidates(),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        candidateResult,
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
