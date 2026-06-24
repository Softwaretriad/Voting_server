import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { EC_ROLE, isEcRole } from "./ecRole.js";
import { createRedisClient, isRedisUrlConfigured } from "./redisClient.js";

let io = null;
let monitorPayloadBuilder = null;
let studentElectionPayloadBuilder = null;
let socketRedisAdapterEnabled = false;
const isSocketDebugEnabled = () => process.env.SOCKET_DEBUG === "true";
const socketDebug = (...args) => {
  if (isSocketDebugEnabled()) {
    console.log("[socket]", ...args);
  }
};

const getTokenFromSocket = (socket) => {
  const authToken = socket.handshake.auth?.token;
  if (authToken) {
    return String(authToken).trim();
  }

  const authHeader = socket.handshake.headers?.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  return "";
};

const getEcElectionRoom = (electionId) => `ec:election:${electionId}`;
const getStudentElectionRoom = (electionId) => `student:election:${electionId}`;
const getStudentNotificationRoom = (studentId) => `student:notifications:${studentId}`;
const getStudentUserRoom = (studentId) => `student:user:${studentId}`;
const getEcNotificationRoom = (ecUserId) => `ec:notifications:${ecUserId}`;
const getEcSchoolRoom = (schoolId) => `ec:school:${schoolId}`;
const isDatabaseReady = () => mongoose.connection.readyState === 1;
const getSocketStudentId = (socket) =>
  socket.data.user.studentId || (isEcRole(socket.data.user.role) ? socket.data.user.userId : null);

export const registerMonitorPayloadBuilder = (builder) => {
  monitorPayloadBuilder = builder;
};

export const registerStudentElectionPayloadBuilder = (builder) => {
  studentElectionPayloadBuilder = builder;
};

export const getSocketHealth = () => ({
  databaseReady: isDatabaseReady(),
  socketDebugEnabled: isSocketDebugEnabled(),
  ecMonitorBuilderRegistered: Boolean(monitorPayloadBuilder),
  studentElectionBuilderRegistered: Boolean(studentElectionPayloadBuilder),
  socketServerAttached: Boolean(io),
  socketConnectionCount: io?.engine?.clientsCount || 0,
  redisAdapterConfigured: isRedisUrlConfigured(),
  redisAdapterEnabled: socketRedisAdapterEnabled,
});

const attachRedisSocketAdapter = async (socketServer) => {
  if (!isRedisUrlConfigured()) {
    return;
  }

  try {
    const [{ createAdapter }, pubClient] = await Promise.all([
      import("@socket.io/redis-adapter"),
      createRedisClient(),
    ]);

    if (!pubClient) {
      return;
    }

    const subClient = pubClient.duplicate();
    subClient.on("error", (error) => {
      console.error("Redis socket adapter subscriber error:", error.message);
    });
    await subClient.connect();

    socketServer.adapter(createAdapter(pubClient, subClient));
    socketRedisAdapterEnabled = true;
    console.log("Socket.IO Redis adapter enabled");
  } catch (error) {
    socketRedisAdapterEnabled = false;
    console.warn("Socket.IO Redis adapter unavailable:", error.message);
  }
};

export const attachLiveMonitorSocketServer = (httpServer) => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
  });
  attachRedisSocketAdapter(io).catch((error) => {
    socketRedisAdapterEnabled = false;
    console.warn("Socket.IO Redis adapter setup failed:", error.message);
  });

  io.use((socket, next) => {
    try {
      const token = getTokenFromSocket(socket);
      if (!token) {
        socketDebug("auth-missing");
        next(new Error("Authentication token is required"));
        return;
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.user = decoded;
      socketDebug("auth-success", {
        socketId: socket.id,
        role: decoded.role,
        schoolId: decoded.schoolId || null,
        studentId: decoded.studentId || null,
      });
      next();
    } catch (error) {
      socketDebug("auth-failed", { socketId: socket.id, message: error.message });
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    socketDebug("connected", { socketId: socket.id, role: socket.data.user.role });
    const socketStudentId = getSocketStudentId(socket);
    if (socketStudentId) {
      socket.join(getStudentNotificationRoom(socketStudentId));
      socket.join(getStudentUserRoom(socketStudentId));
    }
    if (isEcRole(socket.data.user.role) && socket.data.user.userId) {
      socket.join(getEcNotificationRoom(socket.data.user.userId));
      if (socket.data.user.schoolId) {
        socket.join(getEcSchoolRoom(socket.data.user.schoolId));
      }
    }

    const handleEcMonitorJoin = async ({ electionId } = {}) => {
      if (!isEcRole(socket.data.user.role)) {
        const errorPayload = {
          message: "Only EC members can subscribe to this channel",
          statusCode: 403,
        };
        socket.emit("ec:monitor:error", errorPayload);
        return;
      }

      const normalizedElectionId = String(electionId || "").trim();
      if (!normalizedElectionId || !monitorPayloadBuilder) {
        const errorPayload = {
          message: "electionId is required",
        };
        socket.emit("ec:monitor:error", errorPayload);
        return;
      }

      try {
        socketDebug("ec-join-received", {
          socketId: socket.id,
          electionId: normalizedElectionId,
        });
        if (!isDatabaseReady()) {
          const errorPayload = {
            message: "Database is not ready yet",
            statusCode: 503,
          };
          socket.emit("ec:monitor:error", errorPayload);
          return;
        }

        const payload = await monitorPayloadBuilder({
          electionId: normalizedElectionId,
          schoolId: socket.data.user.schoolId,
        });
        socket.join(getEcElectionRoom(normalizedElectionId));
        socketDebug("ec-joined-room", {
          socketId: socket.id,
          room: getEcElectionRoom(normalizedElectionId),
        });
        socket.emit("ec:monitor:update", payload);
      } catch (error) {
        const errorPayload = {
          message: error.message || "Unable to subscribe to election monitor",
          statusCode: error.statusCode || 500,
        };
        socket.emit("ec:monitor:error", errorPayload);
      }
    };

    socket.on("ec:monitor:join", handleEcMonitorJoin);

    const handleEcMonitorLeave = ({ electionId } = {}) => {
      const normalizedElectionId = String(electionId || "").trim();
      if (normalizedElectionId) {
        socket.leave(getEcElectionRoom(normalizedElectionId));
      }
    };

    socket.on("ec:monitor:leave", handleEcMonitorLeave);

    socket.on("student:election:join", async ({ electionId } = {}) => {
      const subscriberStudentId = getSocketStudentId(socket);
      if (!subscriberStudentId) {
        socket.emit("student:election:error", {
          message: "Only students can subscribe to this channel",
          statusCode: 403,
        });
        return;
      }

      const normalizedElectionId = String(electionId || "").trim();
      if (!normalizedElectionId || !studentElectionPayloadBuilder) {
        socket.emit("student:election:error", {
          message: "electionId is required",
        });
        return;
      }

      try {
        socketDebug("student-join-received", {
          socketId: socket.id,
          electionId: normalizedElectionId,
          studentId: subscriberStudentId,
        });
        if (!isDatabaseReady()) {
          socket.emit("student:election:error", {
            message: "Database is not ready yet",
            statusCode: 503,
          });
          return;
        }

        const payload = await studentElectionPayloadBuilder({
          electionId: normalizedElectionId,
          studentId: subscriberStudentId,
        });
        socket.join(getStudentElectionRoom(normalizedElectionId));
        socketDebug("student-joined-room", {
          socketId: socket.id,
          room: getStudentElectionRoom(normalizedElectionId),
          studentId: subscriberStudentId,
        });
        socket.emit("student:election:update", payload);
      } catch (error) {
        socket.emit("student:election:error", {
          message: error.message || "Unable to subscribe to election updates",
          statusCode: error.statusCode || 500,
        });
      }
    });

    socket.on("student:election:leave", ({ electionId } = {}) => {
      const normalizedElectionId = String(electionId || "").trim();
      if (normalizedElectionId) {
        socket.leave(getStudentElectionRoom(normalizedElectionId));
      }
    });
  });

  return io;
};

export const emitElectionMonitorUpdate = async (electionId) => {
  if (!io || !monitorPayloadBuilder) {
    return false;
  }

  if (!isDatabaseReady()) {
    return false;
  }

  const normalizedElectionId = String(electionId || "").trim();
  if (!normalizedElectionId) {
    return false;
  }

  try {
    const payload = await monitorPayloadBuilder({
      electionId: normalizedElectionId,
      forceRefresh: true,
    });
    socketDebug("ec-update-emitted", {
      electionId: normalizedElectionId,
      room: getEcElectionRoom(normalizedElectionId),
    });
    io.to(getEcElectionRoom(normalizedElectionId)).emit("ec:monitor:update", payload);

    if (studentElectionPayloadBuilder) {
      const studentSockets = await io.in(getStudentElectionRoom(normalizedElectionId)).fetchSockets();
      socketDebug("student-update-targets", {
        electionId: normalizedElectionId,
        room: getStudentElectionRoom(normalizedElectionId),
        sockets: studentSockets.length,
      });
      await Promise.all(
        studentSockets.map(async (socket) => {
          const studentId = getSocketStudentId(socket);
          if (!studentId) {
            return;
          }

          const studentPayload = await studentElectionPayloadBuilder({
            electionId: normalizedElectionId,
            studentId,
          });
          socketDebug("student-update-emitted", {
            electionId: normalizedElectionId,
            socketId: socket.id,
            studentId,
          });
          socket.emit("student:election:update", studentPayload);
        })
      );
    }

    return true;
  } catch {
    return false;
  }
};

export const emitNotification = async ({ recipientType, recipientId, payload }) => {
  if (!io || !recipientType || !recipientId || !payload) {
    return false;
  }

  const normalizedRecipientId = String(recipientId || "").trim();
  if (!normalizedRecipientId) {
    return false;
  }

  if (recipientType === "student") {
    io.to(getStudentNotificationRoom(normalizedRecipientId)).emit(
      "student:notification:new",
      payload
    );
    return true;
  }

  if (recipientType === EC_ROLE) {
    io.to(getEcNotificationRoom(normalizedRecipientId)).emit(
      "ec:notification:new",
      payload
    );
    return true;
  }

  return false;
};

export const emitStudentScopedEvent = async ({
  eventName,
  studentIds = [],
  payload,
}) => {
  if (!io || !eventName || !payload) {
    return false;
  }

  const uniqueStudentIds = Array.from(
    new Set(studentIds.map((id) => String(id || "").trim()).filter(Boolean))
  );

  if (uniqueStudentIds.length === 0) {
    return false;
  }

  uniqueStudentIds.forEach((studentId) => {
    io.to(getStudentUserRoom(studentId)).emit(eventName, payload);
  });

  return true;
};

export const emitAdminSchoolEvent = async ({
  eventName,
  schoolId,
  payload,
}) => {
  if (!io || !eventName || !schoolId || !payload) {
    return false;
  }

  io.to(getEcSchoolRoom(String(schoolId))).emit(eventName, payload);
  return true;
};
