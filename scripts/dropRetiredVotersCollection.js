import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const CONFIRMATION = "drop-retired-voters-collection";
const confirmed =
  process.env.DROP_RETIRED_VOTERS_CONFIRM === CONFIRMATION ||
  process.env.CLEANUP_CONFIRM === CONFIRMATION;

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const db = mongoose.connection.db;
  const exists = await db
    .listCollections({ name: "voters" })
    .hasNext();

  if (!exists) {
    console.log("Retired voters collection does not exist.");
    await mongoose.disconnect();
    return;
  }

  const count = await db.collection("voters").countDocuments();
  console.log(`Retired voters collection found with ${count} documents.`);

  if (!confirmed) {
    console.log(
      `Dry run only. Set DROP_RETIRED_VOTERS_CONFIRM=${CONFIRMATION} to drop it.`
    );
    await mongoose.disconnect();
    return;
  }

  await db.collection("voters").drop();
  console.log("Dropped retired voters collection.");
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Failed to drop retired voters collection:", error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
