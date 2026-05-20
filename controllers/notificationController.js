import Notification from "../models/Notification.js";
import ECUser from "../models/ECUser.js";
import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";
import {
  normalizeNotificationPreferences,
} from "../utils/notificationPreferences.js";

const mapNotification = (notification) => ({
  _id: notification._id.toString(),
  recipientType:
    notification.recipientType ||
    (notification.studentId ? "student" : notification.adminId ? "admin" : "student"),
  type: notification.type || "legacy_notification",
  title: notification.title,
  message: notification.message,
  priority: notification.priority || "normal",
  data: notification.data || {},
  createdAt: notification.createdAt.toISOString(),
  isRead: notification.isRead,
  readAt: notification.readAt ? notification.readAt.toISOString() : null,
});

const mapNotificationPreferences = (preferences = {}) =>
  normalizeNotificationPreferences(preferences);

const applyNotificationPreferenceUpdates = (target, updates = {}) => {
  const currentPreferences = normalizeNotificationPreferences(
    target.notificationPreferences || {}
  );

  target.notificationPreferences = {
    ...currentPreferences,
    ...updates,
  };

  return target.notificationPreferences;
};

const findAdminPreferenceOwner = async (adminUserId) => {
  const legacyAdmin = await ECUser.findById(adminUserId).select("notificationPreferences");
  if (legacyAdmin) {
    return legacyAdmin;
  }

  return Student.findOne({
    _id: adminUserId,
    accountRole: "admin",
  }).select("notificationPreferences");
};

export const getStudentNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to access these notifications");
    }

    const notifications = await Notification.find({
      $or: [
        {
          recipientType: "student",
          studentId: userId,
        },
        {
          studentId: userId,
          recipientType: { $exists: false },
        },
      ],
    }).sort({ createdAt: -1 });

    return res.status(200).json(notifications.map(mapNotification));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load notifications");
  }
};

export const markStudentNotificationAsRead = async (req, res) => {
  try {
    const { userId, notificationId } = req.params;

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to update these notifications");
    }

    const notification = await Notification.findOne({
      _id: notificationId,
      $or: [
        {
          recipientType: "student",
          studentId: userId,
        },
        {
          studentId: userId,
          recipientType: { $exists: false },
        },
      ],
    });

    if (!notification) {
      return sendError(res, 404, "Notification not found");
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    return res.status(200).json(mapNotification(notification));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to update notification");
  }
};

export const getAdminNotifications = async (req, res) => {
  try {
    const { adminUserId } = req.params;

    if (req.ecUser._id.toString() !== adminUserId) {
      return sendError(res, 403, "You are not allowed to access these notifications");
    }

    const notifications = await Notification.find({
      $or: [
        {
          recipientType: "admin",
          adminId: adminUserId,
        },
        {
          adminId: adminUserId,
          recipientType: { $exists: false },
        },
      ],
    }).sort({ createdAt: -1 });

    return res.status(200).json(notifications.map(mapNotification));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load notifications");
  }
};

export const markAdminNotificationAsRead = async (req, res) => {
  try {
    const { adminUserId, notificationId } = req.params;

    if (req.ecUser._id.toString() !== adminUserId) {
      return sendError(res, 403, "You are not allowed to update these notifications");
    }

    const notification = await Notification.findOne({
      _id: notificationId,
      $or: [
        {
          recipientType: "admin",
          adminId: adminUserId,
        },
        {
          adminId: adminUserId,
          recipientType: { $exists: false },
        },
      ],
    });

    if (!notification) {
      return sendError(res, 404, "Notification not found");
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    return res.status(200).json(mapNotification(notification));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to update notification");
  }
};

export const getStudentNotificationPreferences = async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to access these notification preferences");
    }

    const student = await Student.findById(userId).select("notificationPreferences");
    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    return res.status(200).json(mapNotificationPreferences(student.notificationPreferences));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load notification preferences");
  }
};

export const updateStudentNotificationPreferences = async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to update these notification preferences");
    }

    const student = await Student.findById(userId).select("notificationPreferences");
    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    applyNotificationPreferenceUpdates(student, req.body || {});
    await student.save();

    return res.status(200).json(mapNotificationPreferences(student.notificationPreferences));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to update notification preferences");
  }
};

export const getAdminNotificationPreferences = async (req, res) => {
  try {
    const { adminUserId } = req.params;

    if (req.ecUser._id.toString() !== adminUserId) {
      return sendError(res, 403, "You are not allowed to access these notification preferences");
    }

    const admin = await findAdminPreferenceOwner(adminUserId);
    if (!admin) {
      return sendError(res, 404, "Admin not found");
    }

    return res.status(200).json(mapNotificationPreferences(admin.notificationPreferences));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load notification preferences");
  }
};

export const updateAdminNotificationPreferences = async (req, res) => {
  try {
    const { adminUserId } = req.params;

    if (req.ecUser._id.toString() !== adminUserId) {
      return sendError(res, 403, "You are not allowed to update these notification preferences");
    }

    const admin = await findAdminPreferenceOwner(adminUserId);
    if (!admin) {
      return sendError(res, 404, "Admin not found");
    }

    applyNotificationPreferenceUpdates(admin, req.body || {});
    await admin.save();

    return res.status(200).json(mapNotificationPreferences(admin.notificationPreferences));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to update notification preferences");
  }
};
