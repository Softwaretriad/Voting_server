import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import schoolRoutes from "./routes/schoolRoutes.js";
import ecRoutes from "./routes/ecRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import studentElectionRoutes from "./routes/studentElectionRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import voteRoutes from "./routes/voteRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import newsRoutes from "./routes/newsRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { corsMiddleware, securityHeaders } from "./middleware/security.js";
import { verifyEmailTransport } from "./utils/sendEmail.js";
import {
  processElectionLifecycle,
  startElectionResultsProcessor,
} from "./utils/electionResultsProcessor.js";

dotenv.config();

const app = express();
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(express.json());
app.use("/assets", express.static(path.join(process.cwd(), "public", "assets")));

app.use("/api/ec", ecRoutes);
app.use("/auth", authRoutes);
app.use("/schools", schoolRoutes);
app.use("/students", studentRoutes);
app.use("/elections", studentElectionRoutes);
app.use("/categories", categoryRoutes);
app.use("/votes", voteRoutes);
app.use("/notifications", notificationRoutes);
app.use("/news", newsRoutes);
app.use("/admin", adminRoutes);

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("MongoDB connected");
    await verifyEmailTransport();
    await processElectionLifecycle();
    startElectionResultsProcessor();
  })
  .catch((err) => console.error("MongoDB error:", err));

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
