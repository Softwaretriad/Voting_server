import Notification from "../models/Notification.js";
import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";
import {
  normalizeNotificationPreferences,
} from "../utils/notificationPreferences.js";
import { EC_ROLE, ecRecipientTypeQuery, ecRoleQuery, normalizeRecipientType } from "../utils/ecRole.js";

const mapNotification = (notification) => ({
  _id: notification._id.toString(),
  recipientType: normalizeRecipientType(
    notification.recipientType ||
      (notification.studentId ? "student" : notification.ecUserId ? EC_ROLE : "student")
  ),
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

const findEcPreferenceOwner = async (ecUserId) => {
  return Student.findOne({
    _id: ecUserId,
    accountRole: ecRoleQuery(),
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

export const markAllStudentNotificationsAsRead = async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to update these notifications");
    }

    const readAt = new Date();
    const result = await Notification.updateMany(
      {
        isRead: false,
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
      },
      {
        $set: {
          isRead: true,
          readAt,
        },
      }
    );

    return res.status(200).json({
      updatedCount: result.modifiedCount || 0,
      readAt: readAt.toISOString(),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to update notifications");
  }
};

export const getAdminNotifications = async (req, res) => {
  try {
    const { ecUserId } = req.params;

    if (req.ecUser._id.toString() !== ecUserId) {
      return sendError(res, 403, "You are not allowed to access these notifications");
    }

    const notifications = await Notification.find({
      recipientType: ecRecipientTypeQuery(),
      ecUserId,
    }).sort({ createdAt: -1 });

    return res.status(200).json(notifications.map(mapNotification));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load notifications");
  }
};

export const markAdminNotificationAsRead = async (req, res) => {
  try {
    const { ecUserId } = req.params;
    const { notificationId } = req.params;

    if (req.ecUser._id.toString() !== ecUserId) {
      return sendError(res, 403, "You are not allowed to update these notifications");
    }

    const notification = await Notification.findOne({
      _id: notificationId,
      recipientType: ecRecipientTypeQuery(),
      ecUserId,
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

export const markAllAdminNotificationsAsRead = async (req, res) => {
  try {
    const { ecUserId } = req.params;

    if (req.ecUser._id.toString() !== ecUserId) {
      return sendError(res, 403, "You are not allowed to update these notifications");
    }

    const readAt = new Date();
    const result = await Notification.updateMany(
      {
        isRead: false,
        recipientType: ecRecipientTypeQuery(),
        ecUserId,
      },
      {
        $set: {
          isRead: true,
          readAt,
        },
      }
    );

    return res.status(200).json({
      updatedCount: result.modifiedCount || 0,
      readAt: readAt.toISOString(),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to update notifications");
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
    const { ecUserId } = req.params;

    if (req.ecUser._id.toString() !== ecUserId) {
      return sendError(res, 403, "You are not allowed to access these notification preferences");
    }

    const ecUser = await findEcPreferenceOwner(ecUserId);
    if (!ecUser) {
      return sendError(res, 404, "EC user not found");
    }

    return res.status(200).json(mapNotificationPreferences(ecUser.notificationPreferences));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load notification preferences");
  }
};

export const updateAdminNotificationPreferences = async (req, res) => {
  try {
    const { ecUserId } = req.params;

    if (req.ecUser._id.toString() !== ecUserId) {
      return sendError(res, 403, "You are not allowed to update these notification preferences");
    }

    const ecUser = await findEcPreferenceOwner(ecUserId);
    if (!ecUser) {
      return sendError(res, 404, "EC user not found");
    }

    applyNotificationPreferenceUpdates(ecUser, req.body || {});
    await ecUser.save();

    return res.status(200).json(mapNotificationPreferences(ecUser.notificationPreferences));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to update notification preferences");
  }
};
