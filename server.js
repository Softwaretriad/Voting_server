import express from "express";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import http from "http";
import schoolRoutes from "./routes/schoolRoutes.js";
import ecRoutes from "./routes/ecRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import studentElectionRoutes from "./routes/studentElectionRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import voteRoutes from "./routes/voteRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import deviceRoutes from "./routes/deviceRoutes.js";
import debugRoutes from "./routes/debugRoutes.js";
import { corsMiddleware, securityHeaders } from "./middleware/security.js";
import { verifyEmailTransport } from "./utils/sendEmail.js";
import {
  attachLiveMonitorSocketServer,
  getSocketHealth,
} from "./utils/liveMonitorSocket.js";
import {
  processElectionLifecycle,
  startElectionResultsProcessor,
} from "./utils/electionResultsProcessor.js";

dotenv.config();

const app = express();
const httpServer = http.createServer(app);
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(express.json());
app.use(
  "/assets",
  express.static(path.join(process.cwd(), "public", "assets"), {
    maxAge: "365d",
    immutable: true,
  })
);

app.use("/api/ec", ecRoutes);
app.use("/auth", authRoutes);
app.use("/schools", schoolRoutes);
app.use("/students", studentRoutes);
app.use("/elections", studentElectionRoutes);
app.use("/categories", categoryRoutes);
app.use("/votes", voteRoutes);
app.use("/notifications", notificationRoutes);
app.use("/uploads", uploadRoutes);
app.use("/devices", deviceRoutes);
app.use("/admin", adminRoutes);
app.use("/debug", debugRoutes);
app.get("/debug/socket-health", (_req, res) => {
  res.status(200).json({
    ...getSocketHealth(),
    mongoReadyState: mongoose.connection.readyState,
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 5000;
attachLiveMonitorSocketServer(httpServer);

const startServer = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    await verifyEmailTransport();
    await processElectionLifecycle();
    startElectionResultsProcessor();

    httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (error) {
    console.error("MongoDB error:", error);
    process.exit(1);
  }
};

startServer();
