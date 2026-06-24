import ActivityLog from "../models/ActivityLog.js";
import Student from "../models/Student.js";
import { EC_ROLE } from "./ecRole.js";

const buildActorSnapshot = async ({ actorType, actorId }) => {
  if (!actorId || actorType !== EC_ROLE) {
    return {};
  }

  const actor = await Student.findById(actorId)
    .select("firstName lastName email studentId")
    .lean();

  if (!actor) {
    return {};
  }

  const actorFirstName = actor.firstName || "";
  const actorLastName = actor.lastName || "";
  const actorName = `${actorFirstName} ${actorLastName}`.trim();

  return {
    actorName,
    actorFirstName,
    actorLastName,
    actorEmail: actor.email || "",
    actorStudentId: actor.studentId || "",
  };
};

export const recordActivity = async ({
  actorType,
  actorId = null,
  schoolId = null,
  action,
  metadata = {},
}) => {
  try {
    const actorSnapshot = await buildActorSnapshot({ actorType, actorId });
    const safeMetadata = metadata || {};

    await ActivityLog.create({
      actorType,
      actorId,
      ...actorSnapshot,
      schoolId,
      action,
      metadata: {
        ...safeMetadata,
        ecName: safeMetadata.ecName || actorSnapshot.actorName || "",
        ecFirstName: safeMetadata.ecFirstName || actorSnapshot.actorFirstName || "",
        ecLastName: safeMetadata.ecLastName || actorSnapshot.actorLastName || "",
        ecEmail: safeMetadata.ecEmail || actorSnapshot.actorEmail || "",
        ecStudentId: safeMetadata.ecStudentId || actorSnapshot.actorStudentId || "",
      },
    });
  } catch (error) {
    console.error("Activity log write failed:", error.message);
  }
};
