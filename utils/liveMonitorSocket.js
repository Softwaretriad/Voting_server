import { Server as SocketIOServer } from "socket.io";
import mongoose from "mongoose";
import Student from "../models/Student.js";
import { EC_ROLE, ecRoleQuery, isEcRole } from "./ecRole.js";
import {
  createRedisClient,
  getRedisClient,
  isRedisUrlConfigured,
} from "./redisClient.js";
import { verifyToken } from "./studentAuth.js";

let io = null;
let monitorPayloadBuilder = null;
let studentElectionPayloadBuilder = null;
let socketRedisAdapterEnabled = false;
let socketEventSubscriberEnabled = false;
const SOCKET_EVENT_CHANNEL = process.env.SOCKET_EVENT_CHANNEL || "myunivote:socket-events";
const STUDENT_ELECTION_JOIN_TIMEOUT_MS = Number(
  process.env.STUDENT_ELECTION_JOIN_TIMEOUT_MS || 10000
);
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

const withTimeout = async (promise, timeoutMs, message) => {
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error(message);
      error.statusCode = 504;
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
};

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
  socketEventSubscriberEnabled,
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

const emitLocalSocketEvent = ({ type, eventName, payload, studentIds = [], schoolId }) => {
  if (!io || !payload) {
    return false;
  }

  if (type === "notification") {
    const normalizedRecipientId = String(payload.recipientId || "").trim();
    if (!normalizedRecipientId) {
      return false;
    }

    if (payload.recipientType === "student") {
      io.to(getStudentNotificationRoom(normalizedRecipientId)).emit(
        "student:notification:new",
        payload.notification
      );
      return true;
    }

    if (payload.recipientType === EC_ROLE) {
      io.to(getEcNotificationRoom(normalizedRecipientId)).emit(
        "ec:notification:new",
        payload.notification
      );
      return true;
    }

    return false;
  }

  if (!eventName) {
    return false;
  }

  if (type === "studentScoped") {
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
  }

  if (type === "ecSchool") {
    const normalizedSchoolId = String(schoolId || "").trim();
    if (!normalizedSchoolId) {
      return false;
    }

    io.to(getEcSchoolRoom(normalizedSchoolId)).emit(eventName, payload);
    return true;
  }

  if (type === "ecUser") {
    const normalizedEcUserId = String(payload.ecUserId || "").trim();
    if (!normalizedEcUserId) {
      return false;
    }

    io.to(getEcNotificationRoom(normalizedEcUserId)).emit(eventName, payload);
    io.to(getStudentUserRoom(normalizedEcUserId)).emit(eventName, payload);
    return true;
  }

  return false;
};

const publishSocketEvent = async (event) => {
  if (!isRedisUrlConfigured()) {
    return false;
  }

  const client = await getRedisClient();
  if (!client) {
    return false;
  }

  await client.publish(SOCKET_EVENT_CHANNEL, JSON.stringify(event));
  return true;
};

const handlePublishedSocketEvent = async (event) => {
  if (event?.type === "ecMonitorUpdate") {
    return emitLocalElectionMonitorUpdate(String(event.electionId || "").trim());
  }

  return emitLocalSocketEvent(event);
};

const attachRedisSocketEventSubscriber = async () => {
  if (!isRedisUrlConfigured() || socketEventSubscriberEnabled) {
    return;
  }

  const subscriber = await createRedisClient();
  if (!subscriber) {
    return;
  }

  await subscriber.subscribe(SOCKET_EVENT_CHANNEL, async (message) => {
    try {
      const event = JSON.parse(message);
      await handlePublishedSocketEvent(event);
    } catch (error) {
      console.warn("Socket event subscriber ignored invalid message:", error.message);
    }
  });
  socketEventSubscriberEnabled = true;
  console.log("Socket event Redis subscriber enabled");
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
  attachRedisSocketEventSubscriber().catch((error) => {
    socketEventSubscriberEnabled = false;
    console.warn("Socket event subscriber setup failed:", error.message);
  });

  io.use(async (socket, next) => {
    try {
      const token = getTokenFromSocket(socket);
      if (!token) {
        socketDebug("auth-missing");
        next(new Error("Authentication token is required"));
        return;
      }

      const decoded = verifyToken(token);
      if (decoded.type !== "access") {
        next(new Error("Invalid token scope"));
        return;
      }
      if (!isEcRole(decoded.role) && decoded.role !== "student") {
        next(new Error("Invalid token scope"));
        return;
      }

      const principal = isEcRole(decoded.role)
        ? await Student.findOne({
            _id: decoded.userId,
            accountRole: ecRoleQuery(),
            sessionVersion: decoded.sessionVersion,
          })
            .select("_id")
            .lean()
        : await Student.findOne({
            _id: decoded.studentId,
            accountRole: "student",
            sessionVersion: decoded.sessionVersion,
          })
            .select("_id")
            .lean();
      if (!principal) {
        next(new Error("Session is no longer valid"));
        return;
      }

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

        socketDebug("student-payload-build-start", {
          socketId: socket.id,
          electionId: normalizedElectionId,
          studentId: subscriberStudentId,
        });
        const payload = await withTimeout(
          studentElectionPayloadBuilder({
            electionId: normalizedElectionId,
            studentId: subscriberStudentId,
          }),
          STUDENT_ELECTION_JOIN_TIMEOUT_MS,
          "Timed out while loading election updates"
        );
        socketDebug("student-payload-build-complete", {
          socketId: socket.id,
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
        socketDebug("student-join-failed", {
          socketId: socket.id,
          electionId: normalizedElectionId,
          studentId: subscriberStudentId,
          message: error.message,
          statusCode: error.statusCode || 500,
        });
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

const emitLocalElectionMonitorUpdate = async (normalizedElectionId) => {
  if (!normalizedElectionId || !io || !monitorPayloadBuilder || !isDatabaseReady()) {
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

export const emitElectionMonitorUpdate = async (electionId) => {
  const normalizedElectionId = String(electionId || "").trim();
  if (!normalizedElectionId) {
    return false;
  }

  if (await emitLocalElectionMonitorUpdate(normalizedElectionId)) {
    return true;
  }

  return publishSocketEvent({
    type: "ecMonitorUpdate",
    electionId: normalizedElectionId,
  });
};

export const emitNotification = async ({ recipientType, recipientId, payload }) => {
  if (!recipientType || !recipientId || !payload) {
    return false;
  }

  const normalizedRecipientId = String(recipientId || "").trim();
  if (!normalizedRecipientId) {
    return false;
  }

  const event = {
    type: "notification",
    payload: {
      recipientType,
      recipientId: normalizedRecipientId,
      notification: payload,
    },
  };

  if (!io) {
    return publishSocketEvent(event);
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

  return publishSocketEvent(event);
};

export const emitStudentScopedEvent = async ({
  eventName,
  studentIds = [],
  payload,
}) => {
  if (!eventName || !payload) {
    return false;
  }

  const event = {
    type: "studentScoped",
    eventName,
    studentIds,
    payload,
  };

  if (emitLocalSocketEvent(event)) {
    return true;
  }

  return publishSocketEvent(event);
};

export const emitAdminSchoolEvent = async ({
  eventName,
  schoolId,
  payload,
}) => {
  if (!eventName || !schoolId || !payload) {
    return false;
  }

  const event = {
    type: "ecSchool",
    eventName,
    schoolId,
    payload,
  };

  if (emitLocalSocketEvent(event)) {
    return true;
  }

  return publishSocketEvent(event);
};

export const emitEcUserEvent = async ({ eventName, ecUserId, payload }) => {
  if (!eventName || !ecUserId || !payload) {
    return false;
  }

  const event = {
    type: "ecUser",
    eventName,
    payload: {
      ...payload,
      ecUserId: String(ecUserId),
    },
  };

  if (emitLocalSocketEvent(event)) {
    return true;
  }

  return publishSocketEvent(event);
};
