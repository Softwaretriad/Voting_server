import ActivityLog from "../models/ActivityLog.js";

export const recordActivity = async ({
  actorType,
  actorId = null,
  schoolId = null,
  action,
  metadata = {},
}) => {
  try {
    await ActivityLog.create({
      actorType,
      actorId,
      schoolId,
      action,
      metadata,
    });
  } catch (error) {
    console.error("Activity log write failed:", error.message);
  }
};
