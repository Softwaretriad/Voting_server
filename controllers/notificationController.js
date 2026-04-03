import Notification from "../models/Notification.js";
import { sendError } from "../utils/apiResponse.js";

export const getNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to access these notifications");
    }

    const notifications = await Notification.find({ studentId: userId }).sort({
      createdAt: -1,
    });

    return res.status(200).json(
      notifications.map((notification) => ({
        _id: notification._id.toString(),
        title: notification.title,
        message: notification.message,
        createdAt: notification.createdAt.toISOString(),
        isRead: notification.isRead,
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load notifications");
  }
};
