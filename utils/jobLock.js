import os from "os";
import crypto from "crypto";
import JobLock from "../models/JobLock.js";
import { acquireRedisLock, releaseRedisLock } from "./redisClient.js";

const buildOwner = () => `${os.hostname()}:${process.pid}`;

export const withMongoJobLock = async ({
  key,
  ttlMs,
  task,
}) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const owner = buildOwner();

  let lock = null;
  try {
    lock = await JobLock.findOneAndUpdate(
      {
        key,
        $or: [{ expiresAt: { $lte: now } }, { owner }],
      },
      { $set: { key, owner, expiresAt } },
      { new: true, upsert: true }
    );
  } catch (error) {
    if (error.code === 11000) {
      return { acquired: false, result: null };
    }
    throw error;
  }

  if (!lock || lock.owner !== owner) {
    return { acquired: false, result: null };
  }

  try {
    const result = await task();
    return { acquired: true, result };
  } finally {
    await JobLock.deleteOne({ key, owner }).catch(() => null);
  }
};

export const withDistributedJobLock = async ({ key, ttlMs, task }) => {
  const token = crypto.randomUUID();
  const redisAcquired = await acquireRedisLock({ key, token, ttlMs }).catch(() => false);

  if (redisAcquired) {
    try {
      return { acquired: true, result: await task(), backend: "redis" };
    } finally {
      await releaseRedisLock({ key, token }).catch(() => null);
    }
  }

  return withMongoJobLock({ key, ttlMs, task });
};
