import PushDevice from "../models/PushDevice.js";
import { sendError } from "../utils/apiResponse.js";

const mapDevice = (device) => ({
  id: device._id.toString(),
  recipientType: device.recipientType,
  recipientId: device.recipientId.toString(),
  schoolId: device.schoolId?.toString?.() || null,
  provider: device.provider,
  token: device.token,
  platform: device.platform,
  deviceId: device.deviceId || "",
  notificationsEnabled: Boolean(device.notificationsEnabled),
  isActive: Boolean(device.isActive),
  lastSeenAt: device.lastSeenAt?.toISOString?.() || null,
  createdAt: device.createdAt?.toISOString?.() || null,
  updatedAt: device.updatedAt?.toISOString?.() || null,
});

const upsertDevice = async ({ req, res, provider }) => {
  try {
    const { token, platform = "unknown", deviceId = "", notificationsEnabled = true } =
      req.body || {};

    const normalizedToken = String(token || "").trim();
    if (!normalizedToken) {
      return sendError(res, 400, "token is required");
    }

    const document = await PushDevice.findOneAndUpdate(
      { provider, token: normalizedToken },
      {
        recipientType: req.authUser.recipientType,
        recipientId: req.authUser.id,
        schoolId: req.authUser.schoolId || null,
        provider,
        token: normalizedToken,
        platform: String(platform || "unknown").trim().toLowerCase(),
        deviceId: String(deviceId || "").trim(),
        notificationsEnabled: Boolean(notificationsEnabled),
        isActive: true,
        lastSeenAt: new Date(),
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(200).json(mapDevice(document));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to register device token");
  }
};

const deactivateDeviceByToken = async ({ req, res, provider }) => {
  try {
    const normalizedToken = String(req.params.token || "").trim();
    if (!normalizedToken) {
      return sendError(res, 400, "token is required");
    }

    const device = await PushDevice.findOneAndUpdate(
      {
        provider,
        token: normalizedToken,
        recipientType: req.authUser.recipientType,
        recipientId: req.authUser.id,
      },
      {
        isActive: false,
        notificationsEnabled: false,
        lastSeenAt: new Date(),
      },
      { new: true }
    );

    if (!device) {
      return sendError(res, 404, "Device token not found");
    }

    return res.status(200).json(mapDevice(device));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to remove device token");
  }
};

export const registerPushToken = async (req, res) => upsertDevice({ req, res, provider: "fcm" });

export const deletePushToken = async (req, res) =>
  deactivateDeviceByToken({ req, res, provider: "fcm" });

export const registerApnsToken = async (req, res) => upsertDevice({ req, res, provider: "apns" });

export const deleteApnsToken = async (req, res) =>
  deactivateDeviceByToken({ req, res, provider: "apns" });
