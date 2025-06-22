import express from "express";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import authRoutes from "./routes/auth.js";
import electionRoutes from "./routes/election.js";

dotenv.config();

const app = express();

// ✅ Body parser middleware
app.use(express.json());

connectDB();

app.use("/api/ec", authRoutes);
app.use("/api/election", electionRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

