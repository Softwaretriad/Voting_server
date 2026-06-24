import dotenv from "dotenv";
import mongoose from "mongoose";
import ActivityLog from "../models/ActivityLog.js";
import Student from "../models/Student.js";
import { EC_ROLE } from "../utils/ecRole.js";

dotenv.config();

const buildSnapshot = (student) => {
  const actorFirstName = student.firstName || "";
  const actorLastName = student.lastName || "";

  return {
    actorName: `${actorFirstName} ${actorLastName}`.trim(),
    actorFirstName,
    actorLastName,
    actorEmail: student.email || "",
    actorStudentId: student.studentId || "",
  };
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const logs = await ActivityLog.find({
    actorType: EC_ROLE,
    actorId: { $ne: null },
    $or: [{ actorName: { $exists: false } }, { actorName: "" }],
  }).select("_id actorId metadata");

  let updated = 0;
  let skipped = 0;

  for (const log of logs) {
    const student = await Student.findById(log.actorId)
      .select("firstName lastName email studentId")
      .lean();

    if (!student) {
      skipped += 1;
      continue;
    }

    const snapshot = buildSnapshot(student);
    await ActivityLog.updateOne(
      { _id: log._id },
      {
        $set: {
          ...snapshot,
          metadata: {
            ...(log.metadata || {}),
            ecName: log.metadata?.ecName || snapshot.actorName,
            ecFirstName: log.metadata?.ecFirstName || snapshot.actorFirstName,
            ecLastName: log.metadata?.ecLastName || snapshot.actorLastName,
            ecEmail: log.metadata?.ecEmail || snapshot.actorEmail,
            ecStudentId: log.metadata?.ecStudentId || snapshot.actorStudentId,
          },
        },
      }
    );
    updated += 1;
  }

  console.log({ scanned: logs.length, updated, skipped });
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Activity actor snapshot backfill failed:", error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
