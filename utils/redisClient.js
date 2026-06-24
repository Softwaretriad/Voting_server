let redisClientPromise = null;
let redisImportWarningShown = false;

const isRedisConfigured = () => Boolean(String(process.env.REDIS_URL || "").trim());

export const isRedisUrlConfigured = () => isRedisConfigured();

export const getRedisClient = async () => {
  if (!isRedisConfigured()) {
    return null;
  }

  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      try {
        const { createClient } = await import("redis");
        const client = createClient({ url: process.env.REDIS_URL });

        client.on("error", (error) => {
          console.error("Redis error:", error.message);
        });

        await client.connect();
        return client;
      } catch (error) {
        redisClientPromise = null;
        if (!redisImportWarningShown) {
          redisImportWarningShown = true;
          console.warn(
            "Redis is configured but unavailable. Falling back where possible:",
            error.message
          );
        }
        return null;
      }
    })();
  }

  return redisClientPromise;
};

export const createRedisClient = async () => {
  if (!isRedisConfigured()) {
    return null;
  }

  try {
    const { createClient } = await import("redis");
    const client = createClient({ url: process.env.REDIS_URL });

    client.on("error", (error) => {
      console.error("Redis error:", error.message);
    });

    await client.connect();
    return client;
  } catch (error) {
    console.warn("Redis client unavailable:", error.message);
    return null;
  }
};

export const getCacheJson = async (key) => {
  const client = await getRedisClient();
  if (!client) {
    return null;
  }

  const value = await client.get(key);
  return value ? JSON.parse(value) : null;
};

export const setCacheJson = async (key, value, ttlSeconds) => {
  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
  return true;
};

export const deleteCacheKeys = async (...keys) => {
  const client = await getRedisClient();
  const normalizedKeys = keys.filter(Boolean);
  if (!client || normalizedKeys.length === 0) {
    return false;
  }

  await client.del(normalizedKeys);
  return true;
};

export const acquireRedisLock = async ({ key, token, ttlMs }) => {
  const client = await getRedisClient();
  if (!client || !key || !token) {
    return false;
  }

  const result = await client.set(`lock:${key}`, token, {
    NX: true,
    PX: ttlMs,
  });
  return result === "OK";
};

export const releaseRedisLock = async ({ key, token }) => {
  const client = await getRedisClient();
  if (!client || !key || !token) {
    return false;
  }

  const lockKey = `lock:${key}`;
  const currentToken = await client.get(lockKey);
  if (currentToken !== token) {
    return false;
  }

  await client.del(lockKey);
  return true;
};

export const getRedisHealth = async () => {
  if (!isRedisConfigured()) {
    return {
      configured: false,
      connected: false,
    };
  }

  try {
    const client = await getRedisClient();
    if (!client) {
      return {
        configured: true,
        connected: false,
      };
    }

    const pong = await client.ping();
    const info = await client.info("memory").catch(() => "");
    const usedMemoryMatch = info.match(/^used_memory:(\d+)/m);
    const usedMemoryHumanMatch = info.match(/^used_memory_human:(.+)$/m);
    const maxMemoryMatch = info.match(/^maxmemory:(\d+)/m);
    const maxMemoryPolicyMatch = info.match(/^maxmemory_policy:(.+)$/m);

    return {
      configured: true,
      connected: pong === "PONG",
      memory: {
        usedBytes: usedMemoryMatch ? Number(usedMemoryMatch[1]) : null,
        usedHuman: usedMemoryHumanMatch ? usedMemoryHumanMatch[1].trim() : null,
        maxBytes: maxMemoryMatch ? Number(maxMemoryMatch[1]) : null,
        policy: maxMemoryPolicyMatch ? maxMemoryPolicyMatch[1].trim() : null,
      },
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error: error.message,
    };
  }
};
