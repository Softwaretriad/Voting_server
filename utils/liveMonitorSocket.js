import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

let io = null;
let monitorPayloadBuilder = null;
let studentElectionPayloadBuilder = null;
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

const getAdminElectionRoom = (electionId) => `admin:election:${electionId}`;
const getStudentElectionRoom = (electionId) => `student:election:${electionId}`;
const getStudentNotificationRoom = (studentId) => `student:notifications:${studentId}`;
const getStudentUserRoom = (studentId) => `student:user:${studentId}`;
const getAdminNotificationRoom = (adminId) => `admin:notifications:${adminId}`;
const getAdminSchoolRoom = (schoolId) => `admin:school:${schoolId}`;
const isDatabaseReady = () => mongoose.connection.readyState === 1;

export const registerMonitorPayloadBuilder = (builder) => {
  monitorPayloadBuilder = builder;
};

export const registerStudentElectionPayloadBuilder = (builder) => {
  studentElectionPayloadBuilder = builder;
};

export const getSocketHealth = () => ({
  databaseReady: isDatabaseReady(),
  socketDebugEnabled: isSocketDebugEnabled(),
  adminMonitorBuilderRegistered: Boolean(monitorPayloadBuilder),
  studentElectionBuilderRegistered: Boolean(studentElectionPayloadBuilder),
  socketServerAttached: Boolean(io),
});

export const attachLiveMonitorSocketServer = (httpServer) => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
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
    if (socket.data.user.role === "student" && socket.data.user.studentId) {
      socket.join(getStudentNotificationRoom(socket.data.user.studentId));
      socket.join(getStudentUserRoom(socket.data.user.studentId));
    }
    if (socket.data.user.role === "admin" && socket.data.user.userId) {
      socket.join(getAdminNotificationRoom(socket.data.user.userId));
      if (socket.data.user.schoolId) {
        socket.join(getAdminSchoolRoom(socket.data.user.schoolId));
      }
    }

    socket.on("admin:monitor:join", async ({ electionId } = {}) => {
      if (socket.data.user.role !== "admin") {
        socket.emit("admin:monitor:error", {
          message: "Only admins can subscribe to this channel",
          statusCode: 403,
        });
        return;
      }

      const normalizedElectionId = String(electionId || "").trim();
      if (!normalizedElectionId || !monitorPayloadBuilder) {
        socket.emit("admin:monitor:error", {
          message: "electionId is required",
        });
        return;
      }

      try {
        socketDebug("admin-join-received", {
          socketId: socket.id,
          electionId: normalizedElectionId,
        });
        if (!isDatabaseReady()) {
          socket.emit("admin:monitor:error", {
            message: "Database is not ready yet",
            statusCode: 503,
          });
          return;
        }

        const payload = await monitorPayloadBuilder({
          electionId: normalizedElectionId,
          schoolId: socket.data.user.schoolId,
        });
        socket.join(getAdminElectionRoom(normalizedElectionId));
        socketDebug("admin-joined-room", {
          socketId: socket.id,
          room: getAdminElectionRoom(normalizedElectionId),
        });
        socket.emit("admin:monitor:update", payload);
      } catch (error) {
        socket.emit("admin:monitor:error", {
          message: error.message || "Unable to subscribe to election monitor",
          statusCode: error.statusCode || 500,
        });
      }
    });

    socket.on("admin:monitor:leave", ({ electionId } = {}) => {
      const normalizedElectionId = String(electionId || "").trim();
      if (normalizedElectionId) {
        socket.leave(getAdminElectionRoom(normalizedElectionId));
      }
    });

    socket.on("student:election:join", async ({ electionId } = {}) => {
      if (socket.data.user.role !== "student") {
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
          studentId: socket.data.user.studentId,
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
          studentId: socket.data.user.studentId,
        });
        socket.join(getStudentElectionRoom(normalizedElectionId));
        socketDebug("student-joined-room", {
          socketId: socket.id,
          room: getStudentElectionRoom(normalizedElectionId),
          studentId: socket.data.user.studentId,
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
    const payload = await monitorPayloadBuilder({ electionId: normalizedElectionId });
    socketDebug("admin-update-emitted", {
      electionId: normalizedElectionId,
      room: getAdminElectionRoom(normalizedElectionId),
    });
    io.to(getAdminElectionRoom(normalizedElectionId)).emit("admin:monitor:update", payload);

    if (studentElectionPayloadBuilder) {
      const studentSockets = await io.in(getStudentElectionRoom(normalizedElectionId)).fetchSockets();
      socketDebug("student-update-targets", {
        electionId: normalizedElectionId,
        room: getStudentElectionRoom(normalizedElectionId),
        sockets: studentSockets.length,
      });
      await Promise.all(
        studentSockets.map(async (socket) => {
          const studentPayload = await studentElectionPayloadBuilder({
            electionId: normalizedElectionId,
            studentId: socket.data.user.studentId,
          });
          socketDebug("student-update-emitted", {
            electionId: normalizedElectionId,
            socketId: socket.id,
            studentId: socket.data.user.studentId,
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

  if (recipientType === "admin") {
    io.to(getAdminNotificationRoom(normalizedRecipientId)).emit(
      "admin:notification:new",
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

  io.to(getAdminSchoolRoom(String(schoolId))).emit(eventName, payload);
  return true;
};
