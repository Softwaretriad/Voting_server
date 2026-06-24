import Election from "../models/Election.js";
import Notification from "../models/Notification.js";
import Student from "../models/Student.js";
import Vote from "../models/Vote.js";
import Voter from "../models/Voter.js";
import { emitNotification } from "./liveMonitorSocket.js";
import { canDeliverNotification } from "./notificationPreferences.js";
import { sendPushNotificationToDevices } from "./pushDelivery.js";
import { EC_ROLE, ecRoleQuery } from "./ecRole.js";

const isPushDebugEnabled = () =>
  String(process.env.PUSH_DEBUG || process.env.SOCKET_DEBUG || "").toLowerCase() === "true";

const logNotificationDebug = (...args) => {
  if (isPushDebugEnabled()) {
    console.log("[notificationService]", ...args);
  }
};

const mapNotification = (notification) => ({
  _id: notification._id.toString(),
  recipientType: notification.recipientType,
  type: notification.type,
  title: notification.title,
  message: notification.message,
  priority: notification.priority || "normal",
  data: notification.data || {},
  isRead: Boolean(notification.isRead),
  createdAt: notification.createdAt?.toISOString?.() || new Date().toISOString(),
  readAt: notification.readAt?.toISOString?.() || null,
});

const findEcNotificationPreferenceOwner = async (ecUserId) => {
  return Student.findOne({
    _id: ecUserId,
    accountRole: ecRoleQuery(),
  }).select("notificationPreferences");
};

const createNotification = async ({
  recipientType,
  studentId = null,
  ecUserId = null,
  schoolId = null,
  type,
  title,
  message,
  priority = "normal",
  data = {},
}) => {
  const notification = await Notification.create({
    recipientType,
    studentId,
    ecUserId,
    schoolId,
    type,
    title,
    message,
    priority,
    data,
  });

  let recipient = null;
  if (recipientType === "student" && studentId) {
    recipient = await Student.findById(studentId).select("notificationPreferences");
  } else if (recipientType === EC_ROLE && ecUserId) {
    recipient = await findEcNotificationPreferenceOwner(ecUserId);
  }

  const resolvedRecipientId = recipientType === "student" ? studentId : ecUserId;
  const canDeliver = canDeliverNotification({
    preferences: recipient?.notificationPreferences,
    type,
  });

  logNotificationDebug("Notification created", {
    notificationId: notification._id.toString(),
    recipientType,
    recipientId: String(resolvedRecipientId || ""),
    type,
    title,
    canDeliver,
  });

  if (canDeliver) {
    try {
      await emitNotification({
        recipientType,
        recipientId: resolvedRecipientId,
        payload: mapNotification(notification),
      });
      logNotificationDebug("Socket notification emitted", {
        notificationId: notification._id.toString(),
        recipientType,
        recipientId: String(resolvedRecipientId || ""),
      });
    } catch (error) {
      logNotificationDebug("Socket notification emit failed", {
        notificationId: notification._id.toString(),
        error: error.message,
      });
    }

    try {
      const pushResult = await sendPushNotificationToDevices({
        recipientType,
        recipientId: resolvedRecipientId,
        notification,
      });
      logNotificationDebug("Push notification processed", {
        notificationId: notification._id.toString(),
        recipientType,
        recipientId: String(resolvedRecipientId || ""),
        pushResult,
      });
    } catch (error) {
      logNotificationDebug("Push notification failed", {
        notificationId: notification._id.toString(),
        recipientType,
        recipientId: String(resolvedRecipientId || ""),
        error: error.message,
      });
    }
  } else {
    logNotificationDebug("Notification delivery suppressed by preferences", {
      notificationId: notification._id.toString(),
      recipientType,
      recipientId: String(resolvedRecipientId || ""),
      type,
    });
  }

  return notification;
};

export const notifyStudent = async ({
  studentId,
  schoolId = null,
  type,
  title,
  message,
  priority = "normal",
  data = {},
}) =>
  createNotification({
    recipientType: "student",
    studentId,
    schoolId,
    type,
    title,
    message,
    priority,
    data,
  });

export const notifyAdmin = async ({
  ecUserId,
  schoolId = null,
  type,
  title,
  message,
  priority = "normal",
  data = {},
}) =>
  createNotification({
    recipientType: EC_ROLE,
    ecUserId,
    schoolId,
    type,
    title,
    message,
    priority,
    data,
  });

export const notifyStudents = async ({
  studentIds = [],
  schoolId = null,
  type,
  title,
  message,
  priority = "normal",
  data = {},
}) => {
  const uniqueStudentIds = Array.from(
    new Set(studentIds.map((id) => String(id || "").trim()).filter(Boolean))
  );

  for (const studentId of uniqueStudentIds) {
    await notifyStudent({ studentId, schoolId, type, title, message, priority, data });
  }
};

export const notifyAdmins = async ({
  ecUserIds = [],
  schoolId = null,
  type,
  title,
  message,
  priority = "normal",
  data = {},
}) => {
  const uniqueEcUserIds = Array.from(
    new Set(ecUserIds.map((id) => String(id || "").trim()).filter(Boolean))
  );

  for (const ecUserId of uniqueEcUserIds) {
    await notifyAdmin({ ecUserId, schoolId, type, title, message, priority, data });
  }
};

export const notifySchoolAdmins = async ({
  schoolId,
  type,
  title,
  message,
  priority = "normal",
  data = {},
  excludeEcUserIds = [],
}) => {
  const ecMembers = await Student.find({
    schoolId,
    accountRole: ecRoleQuery(),
  }).select("_id");
  const excluded = new Set(excludeEcUserIds.map((id) => String(id)));
  const ecUserIds = Array.from(
    new Set(
      ecMembers
        .map((ecMember) => ecMember._id.toString())
        .filter((id) => !excluded.has(id))
    )
  );

  await notifyAdmins({
    ecUserIds,
    schoolId,
    type,
    title,
    message,
    priority,
    data,
  });
};

export const getEligibleStudentObjectIdsForElection = async (election) => {
  const embeddedStudentIds = (election.eligibleVoters || [])
    .map((voter) => String(voter.studentId || "").trim())
    .filter(Boolean);
  const uploadedVoterRows = await Voter.find({
    electionId: election._id,
    schoolId: election.schoolId,
  }).select("studentId");
  const uploadedStudentIds = uploadedVoterRows
    .map((voter) => String(voter.studentId || "").trim())
    .filter(Boolean);
  const studentIds = Array.from(new Set([...embeddedStudentIds, ...uploadedStudentIds]));

  if (studentIds.length === 0) {
    return [];
  }

  const students = await Student.find({
    schoolId: election.schoolId,
    studentId: { $in: studentIds },
  }).select("_id");

  return students.map((student) => student._id.toString());
};

export const notifyEligibleStudentsForElection = async ({
  election,
  type,
  title,
  message,
  priority = "normal",
  data = {},
}) => {
  const studentIds = await getEligibleStudentObjectIdsForElection(election);
  await notifyStudents({
    studentIds,
    schoolId: election.schoolId,
    type,
    title,
    message,
    priority,
    data: {
      electionId: election._id.toString(),
      ...data,
    },
  });
};

export const notifyRemovedStudentsFromElection = async ({
  schoolId,
  electionId,
  electionTitle,
  removedStudentRegistryIds = [],
}) => {
  const registryIds = Array.from(
    new Set(removedStudentRegistryIds.map((value) => String(value || "").trim()).filter(Boolean))
  );

  if (registryIds.length === 0) {
    return;
  }

  const students = await Student.find({
    schoolId,
    studentId: { $in: registryIds },
  }).select("_id");

  await notifyStudents({
    studentIds: students.map((student) => student._id.toString()),
    schoolId,
    type: "student_removed_from_election",
    title: "Election eligibility updated",
    message: `You are no longer eligible for ${electionTitle}.`,
    priority: "high",
    data: {
      electionId: String(electionId),
      electionTitle,
    },
  });
};

export const maybeNotifyTurnoutMilestone = async (electionInput) => {
  const election =
    electionInput && typeof electionInput === "object" && electionInput._id
      ? electionInput
      : await Election.findById(electionInput);

  if (!election) {
    return false;
  }

  const eligibleCount =
    (await Voter.countDocuments({ electionId: election._id, schoolId: election.schoolId })) ||
    election.eligibleVoters?.length ||
    0;

  if (eligibleCount <= 0) {
    return false;
  }

  const uniqueVoterIds = await Vote.distinct("voterId", { electionId: election._id });
  const accreditedVoters = uniqueVoterIds.length;
  const turnoutPercentage = Math.floor((accreditedVoters / eligibleCount) * 100);
  const milestones = [25, 50, 75, 100];
  const sent = new Set((election.notifications?.turnoutMilestonesSent || []).map(Number));
  const nextMilestone = milestones.find(
    (milestone) => turnoutPercentage >= milestone && !sent.has(milestone)
  );

  if (!nextMilestone) {
    return false;
  }

  sent.add(nextMilestone);
  election.notifications = {
    ...(election.notifications || {}),
    turnoutMilestonesSent: Array.from(sent).sort((a, b) => a - b),
  };
  await election.save();

  await notifySchoolAdmins({
    schoolId: election.schoolId,
    type: "student_turnout_milestone",
    title: "Turnout milestone reached",
    message: `${election.title} has reached ${nextMilestone}% turnout.`,
    priority: "high",
    data: {
      electionId: election._id.toString(),
      electionTitle: election.title,
      turnoutPercentage: nextMilestone,
    },
  });

  return true;
};
