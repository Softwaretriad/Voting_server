import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const students = mongoose.connection.db.collection("students");

  const unsetResult = await students.updateMany(
    { googleSub: null },
    { $unset: { googleSub: "" } }
  );

  const indexes = await students.indexes();
  const googleSubIndex = indexes.find((index) => index.name === "googleSub_1");

  if (googleSubIndex) {
    await students.dropIndex("googleSub_1");
  }

  await students.createIndex(
    { googleSub: 1 },
    {
      name: "googleSub_1",
      unique: true,
      partialFilterExpression: { googleSub: { $type: "string" } },
    }
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        unsetGoogleSubNulls: {
          matched: unsetResult.matchedCount,
          modified: unsetResult.modifiedCount,
        },
        droppedExistingGoogleSubIndex: Boolean(googleSubIndex),
        recreatedGoogleSubIndex: true,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Student googleSub index repair failed:", error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
