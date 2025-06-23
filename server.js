import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import schoolRoutes from "./routes/schoolRoutes.js";
import ecRoutes from "./routes/ecRoutes.js";
import electionRoutes from "./routes/electionRoutes.js";
import userRoutes from "./routes/voterRoutes.js";

dotenv.config();

const app = express();
app.use(express.json());

// Routes
app.use("/api/school", schoolRoutes);
app.use("/api/ec", ecRoutes);
app.use("/api/election", electionRoutes);
app.use("/api/user", userRoutes);

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));

// Catch-all for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
