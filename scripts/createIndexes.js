import dotenv from "dotenv";
import mongoose from "mongoose";
import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import School from "../models/school.js";
import Student from "../models/Student.js";
import Vote from "../models/Vote.js";

dotenv.config();

const models = [School, Student, Election, Aspirant, Vote];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const results = [];
  for (const model of models) {
    await model.createIndexes();
    const indexes = await model.listIndexes();
    results.push({
      model: model.modelName,
      indexes: indexes.map((index) => index.name),
    });
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Index sync failed:", error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
