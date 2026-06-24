import mongoose from "mongoose";
import VoteSideEffectJob from "../models/VoteSideEffectJob.js";
import WorkerHeartbeat from "../models/WorkerHeartbeat.js";
import { getRedisHealth } from "./redisClient.js";
import { getSocketHealth } from "./liveMonitorSocket.js";
import { getRuntimeMetrics } from "./runtimeMetrics.js";

const getStatusCounts = async (Model) => {
  const rows = await Model.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  return rows.reduce((acc, row) => {
    acc[row._id || "unknown"] = row.count;
    return acc;
  }, {});
};

const getOldestPendingAgeSeconds = async (Model, pendingStatuses) => {
  const oldest = await Model.findOne({ status: { $in: pendingStatuses } })
    .sort({ createdAt: 1 })
    .select({ createdAt: 1 })
    .lean();

  if (!oldest?.createdAt) {
    return 0;
  }

  return Math.max(0, Math.round((Date.now() - oldest.createdAt.getTime()) / 1000));
};

const mapHeartbeat = (heartbeat) => {
  const intervalMs = Number(heartbeat.intervalMs || 0);
  const lastSeenAt = heartbeat.lastSuccessAt || heartbeat.lastFailureAt || heartbeat.updatedAt;
  const secondsSinceLastSeen = lastSeenAt
    ? Math.round((Date.now() - new Date(lastSeenAt).getTime()) / 1000)
    : null;
  const staleAfterSeconds = intervalMs > 0 ? Math.ceil((intervalMs * 3) / 1000) : null;

  return {
    workerName: heartbeat.workerName,
    status: heartbeat.status,
    lastSuccessAt: heartbeat.lastSuccessAt,
    lastFailureAt: heartbeat.lastFailureAt,
    lastDurationMs: heartbeat.lastDurationMs,
    lastError: heartbeat.lastError,
    lastResult: heartbeat.lastResult,
    intervalMs,
    secondsSinceLastSeen,
    stale: staleAfterSeconds != null && secondsSinceLastSeen != null
      ? secondsSinceLastSeen > staleAfterSeconds
      : false,
    hostname: heartbeat.hostname,
    pid: heartbeat.pid,
    updatedAt: heartbeat.updatedAt,
  };
};

export const getOpsMetrics = async () => {
  const [
    redis,
    voteSideEffectQueue,
    voteSideEffectOldestPendingAgeSeconds,
    workerHeartbeats,
  ] = await Promise.all([
    getRedisHealth(),
    getStatusCounts(VoteSideEffectJob),
    getOldestPendingAgeSeconds(VoteSideEffectJob, ["queued", "failed"]),
    WorkerHeartbeat.find({}).sort({ workerName: 1 }).lean(),
  ]);

  const mongoConnection = mongoose.connection;
  const processMemory = process.memoryUsage();

  return {
    generatedAt: new Date().toISOString(),
    process: {
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssBytes: processMemory.rss,
        heapUsedBytes: processMemory.heapUsed,
        heapTotalBytes: processMemory.heapTotal,
        externalBytes: processMemory.external,
      },
    },
    mongo: {
      readyState: mongoConnection.readyState,
      readyStateLabel:
        ["disconnected", "connected", "connecting", "disconnecting"][mongoConnection.readyState] ||
        "unknown",
      host: mongoConnection.host || null,
      name: mongoConnection.name || null,
    },
    redis,
    sockets: getSocketHealth(),
    runtime: getRuntimeMetrics(),
    queues: {
      voteSideEffects: {
        byStatus: voteSideEffectQueue,
        pending: (voteSideEffectQueue.queued || 0) + (voteSideEffectQueue.failed || 0),
        failed: voteSideEffectQueue.failed || 0,
        oldestPendingAgeSeconds: voteSideEffectOldestPendingAgeSeconds,
      },
    },
    workers: workerHeartbeats.map(mapHeartbeat),
  };
};
