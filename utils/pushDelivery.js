import http2 from "http2";
import jwt from "jsonwebtoken";
import PushDevice from "../models/PushDevice.js";
import { EC_ROLE, ecRecipientTypeQuery } from "./ecRole.js";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const APNS_PRODUCTION_URL = "https://api.push.apple.com";
const APNS_SANDBOX_URL = "https://api.sandbox.push.apple.com";

const isPushDebugEnabled = () =>
  String(process.env.PUSH_DEBUG || process.env.SOCKET_DEBUG || "").toLowerCase() === "true";

const logPushDebug = (...args) => {
  if (isPushDebugEnabled()) {
    console.log("[pushDelivery]", ...args);
  }
};

const getJsonEnv = (value) => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getFcmConfig = () => {
  const serviceAccount = getJsonEnv(process.env.FCM_SERVICE_ACCOUNT_JSON);
  return {
    projectId: process.env.FCM_PROJECT_ID || serviceAccount?.project_id || "",
    clientEmail: process.env.FCM_CLIENT_EMAIL || serviceAccount?.client_email || "",
    privateKey: (
      process.env.FCM_PRIVATE_KEY ||
      serviceAccount?.private_key ||
      ""
    ).replace(/\\n/g, "\n"),
  };
};

const buildSignedJwtAssertion = ({ clientEmail, privateKey }) => {
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iss: clientEmail,
      scope: FCM_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    privateKey,
    {
      algorithm: "RS256",
      header: { alg: "RS256", typ: "JWT" },
    }
  );
};

const getGoogleAccessToken = async () => {
  const { clientEmail, privateKey } = getFcmConfig();
  if (!clientEmail || !privateKey) {
    logPushDebug("FCM access token skipped because config is missing");
    return "";
  }

  const assertion = buildSignedJwtAssertion({ clientEmail, privateKey });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logPushDebug("Google access token request failed", response.status, errorBody);
    throw new Error(`Failed to fetch Google access token (${response.status})`);
  }

  const payload = await response.json();
  return payload.access_token || "";
};

const buildApnsJwt = () => {
  const keyId = process.env.APNS_KEY_ID || "";
  const teamId = process.env.APNS_TEAM_ID || "";
  const privateKey = (process.env.APNS_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!keyId || !teamId || !privateKey) {
    return "";
  }

  return jwt.sign(
    {},
    privateKey,
    {
      algorithm: "ES256",
      header: {
        alg: "ES256",
        kid: keyId,
      },
      issuer: teamId,
      expiresIn: "55m",
    }
  );
};

const buildPushData = ({ notification }) => {
  const data = {
    id: String(notification._id),
    recipientType: String(notification.recipientType || ""),
    type: String(notification.type || ""),
    title: String(notification.title || ""),
    message: String(notification.message || ""),
    priority: String(notification.priority || "normal"),
    createdAt:
      notification.createdAt?.toISOString?.() || new Date().toISOString(),
  };

  Object.entries(notification.data || {}).forEach(([key, value]) => {
    if (value == null) {
      return;
    }

    data[key] = typeof value === "string" ? value : JSON.stringify(value);
  });

  return data;
};

const deactivateDevice = async (deviceId) => {
  await PushDevice.findByIdAndUpdate(deviceId, {
    isActive: false,
    lastSeenAt: new Date(),
  });
};

const sendFcmToDevice = async ({ device, notification }) => {
  const { projectId } = getFcmConfig();
  if (!projectId) {
    logPushDebug("Skipping FCM send because projectId is missing", {
      deviceId: device._id.toString(),
      recipientType: device.recipientType,
      recipientId: device.recipientId?.toString?.() || String(device.recipientId || ""),
    });
    return { attempted: false, reason: "missing_fcm_config" };
  }

  const accessToken = await getGoogleAccessToken();
  logPushDebug("Sending FCM message", {
    deviceId: device._id.toString(),
    recipientType: device.recipientType,
    recipientId: device.recipientId?.toString?.() || String(device.recipientId || ""),
    projectId,
    notificationType: notification.type,
    title: notification.title,
  });
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: device.token,
          notification: {
            title: notification.title,
            body: notification.message,
          },
          data: buildPushData({ notification }),
          android: {
            priority: notification.priority === "high" ? "high" : "normal",
          },
          apns: {
            headers: {
              "apns-priority": notification.priority === "high" ? "10" : "5",
            },
            payload: {
              aps: {
                sound: "default",
              },
            },
          },
        },
      }),
    }
  );

  if (response.ok) {
    await PushDevice.findByIdAndUpdate(device._id, { lastSeenAt: new Date() });
    logPushDebug("FCM message delivered", {
      deviceId: device._id.toString(),
      notificationType: notification.type,
    });
    return { attempted: true, delivered: true };
  }

  const payload = await response.text();
  logPushDebug("FCM message failed", {
    deviceId: device._id.toString(),
    status: response.status,
    payload,
  });
  if (
    response.status === 404 ||
    payload.includes("UNREGISTERED") ||
    payload.includes("invalid")
  ) {
    await deactivateDevice(device._id);
  }

  return {
    attempted: true,
    delivered: false,
    reason: `fcm_${response.status}`,
  };
};

const sendApnsToDevice = async ({ device, notification }) => {
  const bundleId = process.env.APNS_BUNDLE_ID || "";
  const authToken = buildApnsJwt();

  if (!bundleId || !authToken) {
    return { attempted: false, reason: "missing_apns_config" };
  }

  const baseUrl =
    process.env.APNS_PRODUCTION === "true" ? APNS_PRODUCTION_URL : APNS_SANDBOX_URL;
  const client = http2.connect(baseUrl);

  const payload = JSON.stringify({
    aps: {
      alert: {
        title: notification.title,
        body: notification.message,
      },
      sound: "default",
    },
    data: buildPushData({ notification }),
  });

  const result = await new Promise((resolve) => {
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${device.token}`,
      authorization: `bearer ${authToken}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": notification.priority === "high" ? "10" : "5",
      "content-type": "application/json",
    });

    let body = "";
    req.setEncoding("utf8");
    req.on("response", (headers) => {
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        const status = Number(headers[":status"] || 500);
        if (status >= 200 && status < 300) {
          await PushDevice.findByIdAndUpdate(device._id, { lastSeenAt: new Date() });
          resolve({ attempted: true, delivered: true });
          return;
        }

        if (status === 400 || status === 410) {
          await deactivateDevice(device._id);
        }

        resolve({
          attempted: true,
          delivered: false,
          reason: body || `apns_${status}`,
        });
      });
    });
    req.on("error", (error) => {
      resolve({ attempted: true, delivered: false, reason: error.message });
    });
    req.end(payload);
  });

  client.close();
  return result;
};

export const sendPushNotificationToDevices = async ({
  recipientType,
  recipientId,
  notification,
}) => {
  const normalizedRecipientId = String(recipientId || "").trim();
  if (!normalizedRecipientId || !notification) {
    logPushDebug("Push skipped because recipient or notification is missing", {
      recipientType,
      recipientId: normalizedRecipientId,
      hasNotification: Boolean(notification),
    });
    return { attempted: 0, delivered: 0, skipped: true };
  }

  const devices = await PushDevice.find({
    recipientType: recipientType === EC_ROLE ? ecRecipientTypeQuery() : recipientType,
    recipientId: normalizedRecipientId,
    isActive: true,
    notificationsEnabled: true,
  });

  if (devices.length === 0) {
    logPushDebug("Push skipped because no active devices matched", {
      recipientType,
      recipientId: normalizedRecipientId,
      notificationType: notification.type,
    });
    return { attempted: 0, delivered: 0, skipped: true };
  }

  logPushDebug("Push devices matched", {
    recipientType,
    recipientId: normalizedRecipientId,
    deviceCount: devices.length,
    notificationType: notification.type,
  });

  const results = [];
  for (const device of devices) {
    if (device.provider === "fcm") {
      results.push(await sendFcmToDevice({ device, notification }));
      continue;
    }

    if (device.provider === "apns") {
      results.push(await sendApnsToDevice({ device, notification }));
    }
  }

  const summary = {
    attempted: results.filter((item) => item.attempted).length,
    delivered: results.filter((item) => item.delivered).length,
    results,
  };

  logPushDebug("Push send summary", {
    recipientType,
    recipientId: normalizedRecipientId,
    notificationType: notification.type,
    attempted: summary.attempted,
    delivered: summary.delivered,
    results: summary.results,
  });

  return summary;
};
