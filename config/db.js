import dotenv from "dotenv";
import { connectMongo } from "../utils/mongoConnection.js";
dotenv.config();

const connectDB = async () => {
  try {
    await connectMongo();
    console.log("MongoDB connected");
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  }
};

export default connectDB;
