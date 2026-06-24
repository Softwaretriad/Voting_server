import mongoose from "mongoose";

const mongoOptions = {
  maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE || 10),
  minPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE || 0),
  serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
  socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000),
  connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000),
  retryWrites: process.env.MONGO_RETRY_WRITES
    ? String(process.env.MONGO_RETRY_WRITES).toLowerCase() === "true"
    : true,
};

let connectPromise = null;

export const connectMongo = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectPromise) {
    return connectPromise;
  }

  connectPromise = mongoose
    .connect(process.env.MONGO_URI, mongoOptions)
    .then(() => mongoose.connection)
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
};

export const ensureMongoConnected = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (mongoose.connection.readyState === 2) {
    return connectPromise || mongoose.connection.asPromise();
  }

  return connectMongo();
};
