import { sendError } from "../utils/apiResponse.js";
import { notifyAdmin, notifyStudent } from "../utils/notificationService.js";

export const sendTestPushNotification = async (req, res) => {
  try {
    const {
      title = "Test push",
      message = "This is a backend-triggered push test notification.",
      type = "system_test_push",
      priority = "high",
      data = {},
    } = req.body || {};

    if (!title || !message) {
      return sendError(res, 400, "title and message are required");
    }

    if (!["normal", "high"].includes(priority)) {
      return sendError(res, 400, "priority must be normal or high");
    }

    const payload = {
      schoolId: req.authUser.schoolId || null,
      type: String(type).trim() || "system_test_push",
      title: String(title).trim(),
      message: String(message).trim(),
      priority,
      data: {
        ...(data && typeof data === "object" && !Array.isArray(data) ? data : {}),
        debug: true,
        sentAt: new Date().toISOString(),
      },
    };

    if (req.authUser.recipientType === "student") {
      await notifyStudent({
        studentId: req.authUser.id,
        ...payload,
      });
    } else {
      await notifyAdmin({
        adminId: req.authUser.id,
        ...payload,
      });
    }

    return res.status(200).json({
      ok: true,
      recipientType: req.authUser.recipientType,
      recipientId: req.authUser.id,
      schoolId: req.authUser.schoolId || null,
      title: payload.title,
      message: payload.message,
      type: payload.type,
      priority: payload.priority,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to send test push notification");
  }
};
