import express from "express";
import crypto from "crypto";
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
import ecOperationsRoutes from "./routes/ecOperationsRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import deviceRoutes from "./routes/deviceRoutes.js";
import debugRoutes from "./routes/debugRoutes.js";
import schoolAdminRoutes from "./routes/schoolAdminRoutes.js";
import { connectMongo } from "./utils/mongoConnection.js";
import {
  corsMiddleware,
  enforceHttps,
  securityHeaders,
} from "./middleware/security.js";
import { enforceInputLimits } from "./middleware/inputLimits.js";
import { rejectMongoOperatorKeys } from "./middleware/noSqlProtection.js";
import { noStore } from "./middleware/noStore.js";
import { createRateLimiter } from "./middleware/rateLimit.js";
import { requestMetrics } from "./middleware/requestMetrics.js";
import { verifyEmailTransport } from "./utils/sendEmail.js";
import {
  attachLiveMonitorSocketServer,
  getSocketHealth,
} from "./utils/liveMonitorSocket.js";
import {
  processElectionLifecycle,
  startElectionResultsProcessor,
} from "./utils/electionResultsProcessor.js";
import { getRedisHealth } from "./utils/redisClient.js";
import { getOpsMetrics } from "./utils/opsMetrics.js";

dotenv.config();

const app = express();
const httpServer = http.createServer(app);
app.disable("x-powered-by");
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);
app.use(enforceHttps);
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(requestMetrics);
app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT || "25mb",
    strict: true,
  })
);
app.use((error, _req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body is too large" });
  }
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Request body must contain valid JSON" });
  }
  return next(error);
});
app.use(enforceInputLimits);
app.use(rejectMongoOperatorKeys);
app.use(
  "/assets/logos",
  express.static(path.join(process.cwd(), "public", "assets", "logos"), {
    maxAge: "5m",
  })
);
app.use(
  "/assets",
  express.static(path.join(process.cwd(), "public", "assets"), {
    maxAge: "365d",
    immutable: true,
  })
);

app.use("/api/ec", ecRoutes);
app.use("/auth", authRoutes);
app.use("/school-admin", schoolAdminRoutes);
app.use("/schools", schoolRoutes);
app.use("/students", studentRoutes);
app.use("/elections", studentElectionRoutes);
app.use("/categories", categoryRoutes);
app.use("/votes", voteRoutes);
app.use("/notifications", notificationRoutes);
app.use("/uploads", uploadRoutes);
app.use("/devices", deviceRoutes);
app.use("/ec", ecOperationsRoutes);
if (process.env.NODE_ENV !== "production") {
  app.use("/debug", debugRoutes);
}
const debugRateLimit = createRateLimiter({
  key: "debug-endpoints",
  windowMs: 60 * 1000,
  max: 30,
});
const requireOpsMetricsToken = (req, res, next) => {
  const expectedToken = String(process.env.OPS_METRICS_TOKEN || "").trim();
  if (!expectedToken) {
    return res.status(404).json({ error: "Route not found" });
  }

  const authHeader = String(req.headers.authorization || "");
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const providedToken = String(req.headers["x-ops-token"] || bearerToken || "").trim();

  const expectedBuffer = Buffer.from(expectedToken);
  const providedBuffer = Buffer.from(providedToken);
  const tokenMatches =
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);

  if (!tokenMatches) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
};
app.get(
  "/debug/socket-health",
  noStore,
  debugRateLimit,
  requireOpsMetricsToken,
  async (_req, res) => {
    res.status(200).json({
      ...getSocketHealth(),
      mongoReadyState: mongoose.connection.readyState,
      redis: await getRedisHealth(),
    });
  }
);
app.get(
  "/debug/ops-metrics",
  noStore,
  debugRateLimit,
  requireOpsMetricsToken,
  async (_req, res) => {
  try {
    res.status(200).json(await getOpsMetrics());
  } catch (error) {
    res.status(500).json({
      error: "Unable to load operational metrics",
      message: error.message,
    });
  }
  }
);

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 5000;
attachLiveMonitorSocketServer(httpServer);

const startServer = async () => {
  try {
    await connectMongo();
    console.log("MongoDB connected");

    await verifyEmailTransport();
    if (process.env.ELECTION_LIFECYCLE_IN_API !== "false") {
      await processElectionLifecycle();
      startElectionResultsProcessor();
    } else {
      console.log("Election lifecycle processing is disabled in API process");
    }

    httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (error) {
    console.error("MongoDB error:", error);
    process.exit(1);
  }
};

startServer();
