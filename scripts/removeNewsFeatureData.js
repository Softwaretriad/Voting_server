import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const collections = await mongoose.connection.db
    .listCollections({ name: "news" })
    .toArray();

  if (collections.length > 0) {
    await mongoose.connection.db.dropCollection("news");
    console.log("Dropped news collection");
  } else {
    console.log("News collection does not exist");
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
