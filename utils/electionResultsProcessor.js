import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import School from "../models/school.js";
import Student from "../models/Student.js";
import sendEmail from "./sendEmail.js";
import {
  emitAdminSchoolEvent,
  emitElectionMonitorUpdate,
  emitStudentScopedEvent,
} from "./liveMonitorSocket.js";
import { createElectionResultsPdfBuffer } from "./pdfResults.js";
import { syncSchoolSubscriptionState } from "./plans.js";
import {
  getEligibleStudentObjectIdsForElection,
  notifyEligibleStudentsForElection,
  notifySchoolAdmins,
} from "./notificationService.js";

const MAX_EMAIL_ATTEMPTS = 3;
const STARTING_SOON_WINDOW_MS = 60 * 60 * 1000;
const CLOSING_SOON_WINDOW_MS = 60 * 60 * 1000;

const getElectionDateLabel = (election) => {
  const start = election.startTime
    ? new Date(election.startTime).toISOString().slice(0, 10)
    : "Unknown";
  const end = election.endTime
    ? new Date(election.endTime).toISOString().slice(0, 10)
    : start;

  return start === end ? start : `${start} to ${end}`;
};

const buildStudentHomeElectionEventPayload = (election, statusOverride = null) => ({
  electionId: election._id.toString(),
  status: statusOverride || election.status,
  title: election.title,
  schoolId: election.schoolId?.toString?.() || election.schoolId,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
});

const buildStudentReportElectionEventPayload = (election, statusOverride = null) => ({
  electionId: election._id.toString(),
  status: statusOverride || election.status,
  title: election.title,
  schoolId: election.schoolId?.toString?.() || election.schoolId,
});

const buildAdminHomeElectionEventPayload = (election, statusOverride = null) => ({
  electionId: election._id.toString(),
  status: statusOverride || election.status,
  title: election.title,
  schoolId: election.schoolId?.toString?.() || election.schoolId,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
});

const getCategorySummaries = async (election) => {
  const aspirants = await Aspirant.find({ electionId: election._id }).sort({
    electoralCategory: 1,
    voteCount: -1,
    name: 1,
  });

  const grouped = new Map();

  aspirants.forEach((aspirant) => {
    const key = aspirant.categoryId?.toString() || aspirant.electoralCategory;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(aspirant);
  });

  return Array.from(grouped.values()).map((rows) => {
    const total = rows.reduce((sum, row) => sum + (row.voteCount || 0), 0);
    const winnerId = rows[0]?._id?.toString() || null;

    return {
      title: rows[0]?.electoralCategory || "General",
      rows: rows.map((row) => ({
        name: row.name,
        voteCount: row.voteCount || 0,
        percentage: total > 0 ? (((row.voteCount || 0) / total) * 100).toFixed(1) : "0.0",
        isWinner: row._id.toString() === winnerId,
      })),
    };
  });
};

const sendResultsEmailWithRetry = async ({ student, election, pdfBuffer }) => {
  const subject = `${election.title} - Official Results`;
  const text =
    "Thank you for participating in the election. The official results are attached as a PDF.";

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_EMAIL_ATTEMPTS; attempt += 1) {
    try {
      await sendEmail(student.email, subject, text, {
        attachments: [
          {
            filename: `${election.title.replace(/[^a-z0-9]+/gi, "_")}_results.pdf`,
            content: pdfBuffer,
            contentType: "application/pdf",
          },
        ],
      });

      return { success: true, attempts: attempt };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    success: false,
    attempts: MAX_EMAIL_ATTEMPTS,
    error: lastError?.message || "Failed to send results email",
  };
};

export const processScheduledElections = async ({ forceElectionIds = [] } = {}) => {
  const now = new Date();
  const startingSoonBoundary = new Date(now.getTime() + STARTING_SOON_WINDOW_MS);
  const startingSoonElections = await Election.find({
    status: "scheduled",
    startTime: { $gt: now, $lte: startingSoonBoundary },
    "notifications.startingSoonSentAt": null,
  });

  for (const election of startingSoonElections) {
    await notifyEligibleStudentsForElection({
      election,
      type: "election_starting_soon",
      title: "Election starting soon",
      message: `${election.title} starts within the next hour.`,
      priority: "high",
    });
    election.notifications = {
      ...(election.notifications || {}),
      startingSoonSentAt: new Date(),
    };
    await election.save();
  }

  const filter =
    forceElectionIds.length > 0
      ? { _id: { $in: forceElectionIds } }
      : { status: "scheduled", startTime: { $lte: now }, endTime: { $gt: now } };

  const elections = await Election.find(filter);
  const activated = [];

  for (const election of elections) {
    if (election.status !== "scheduled") {
      continue;
    }

    election.status = "active";
    election.notifications = {
      ...(election.notifications || {}),
      liveSentAt: election.notifications?.liveSentAt || new Date(),
    };
    await election.save();
    const eligibleStudentIds = await getEligibleStudentObjectIdsForElection(election);
    await notifySchoolAdmins({
      schoolId: election.schoolId,
      type: "election_went_live",
      title: "Election is now live",
      message: `${election.title} is now live.`,
      priority: "high",
      data: { electionId: election._id.toString(), electionTitle: election.title },
    });
    await notifyEligibleStudentsForElection({
      election,
      type: "election_is_now_live",
      title: "Election is now live",
      message: `${election.title} is now live.`,
      priority: "high",
    });
    await emitStudentScopedEvent({
      eventName: "election:activated",
      studentIds: eligibleStudentIds,
      payload: buildStudentHomeElectionEventPayload(election, "active"),
    });
    await emitAdminSchoolEvent({
      eventName: "admin:election:activated",
      schoolId: election.schoolId,
      payload: buildAdminHomeElectionEventPayload(election, "active"),
    });
    await emitStudentScopedEvent({
      eventName: "report:election:activated",
      studentIds: eligibleStudentIds,
      payload: buildStudentReportElectionEventPayload(election, "active"),
    });
    await emitElectionMonitorUpdate(election._id.toString());

    activated.push({
      electionId: election._id.toString(),
      title: election.title,
      status: "active",
    });
  }

  return activated;
};

export const processElectionResults = async ({ forceElectionIds = [] } = {}) => {
  const now = new Date();
  const closingSoonBoundary = new Date(now.getTime() + CLOSING_SOON_WINDOW_MS);
  const closingSoonElections = await Election.find({
    status: "active",
    endTime: { $gt: now, $lte: closingSoonBoundary },
    "notifications.closingSoonSentAt": null,
  });

  for (const election of closingSoonElections) {
    await notifyEligibleStudentsForElection({
      election,
      type: "election_closing_soon",
      title: "Election closing soon",
      message: `${election.title} closes within the next hour.`,
      priority: "high",
    });
    election.notifications = {
      ...(election.notifications || {}),
      closingSoonSentAt: new Date(),
    };
    await election.save();
  }

  const filter =
    forceElectionIds.length > 0
      ? { _id: { $in: forceElectionIds } }
      : { status: "active", endTime: { $lte: now } };

  const elections = await Election.find(filter);
  const processed = [];

  for (const election of elections) {
    if (election.resultsEmailSentAt) {
      processed.push({
        electionId: election._id.toString(),
        title: election.title,
        status: "already_processed",
      });
      continue;
    }

    const [school, categorySummaries] = await Promise.all([
      School.findById(election.schoolId),
      getCategorySummaries(election),
    ]);

    const uniqueStudentIds = Array.from(
      new Set(
        election.votes
          .map((vote) => vote.studentId?.toString())
          .filter(Boolean)
      )
    );

    const students = await Student.find({
      _id: { $in: uniqueStudentIds },
      isEmailVerified: true,
    });

    const pdfBuffer = createElectionResultsPdfBuffer({
      electionTitle: election.title,
      schoolName: school?.fullName || school?.name || "Unknown School",
      electionDate: getElectionDateLabel(election),
      generatedAt: new Date().toISOString(),
      totalVotes: election.votes.length,
      categorySummaries,
    });

    let sentCount = 0;
    const failedRecipients = [];

    for (const student of students) {
      const result = await sendResultsEmailWithRetry({
        student,
        election,
        pdfBuffer,
      });

      if (result.success) {
        sentCount += 1;
      } else {
        failedRecipients.push({
          studentId: student._id,
          email: student.email,
          attempts: result.attempts,
          error: result.error,
        });
      }
    }

    election.status = "closed";
    election.resultsEmailSentAt = new Date();
    election.resultsEmailSummary = {
      recipientsTargeted: students.length,
      recipientsSent: sentCount,
      failedRecipients,
    };
    election.notifications = {
      ...(election.notifications || {}),
      closedSentAt: election.notifications?.closedSentAt || new Date(),
      resultsPublishedSentAt:
        election.notifications?.resultsPublishedSentAt || new Date(),
    };
    if (school?.subscriptionTerm === "one_off_election") {
      school.oneOffElectionConsumed = true;
      school.subscriptionActive = false;
      school.subscriptionExpiresAt = new Date();
      syncSchoolSubscriptionState(school);
      await school.save();
    }
    await election.save();
    const eligibleStudentIds = await getEligibleStudentObjectIdsForElection(election);
    await notifySchoolAdmins({
      schoolId: election.schoolId,
      type: "election_closed",
      title: "Election closed",
      message: `${election.title} has closed.`,
      priority: "high",
      data: { electionId: election._id.toString(), electionTitle: election.title },
    });
    await notifySchoolAdmins({
      schoolId: election.schoolId,
      type: "results_generated",
      title: "Results generated",
      message: `Results were generated for ${election.title}.`,
      priority: "high",
      data: { electionId: election._id.toString(), electionTitle: election.title },
    });
    await notifySchoolAdmins({
      schoolId: election.schoolId,
      type: "results_report_ready",
      title: "Results report ready",
      message: `The results report for ${election.title} is ready.`,
      priority: "high",
      data: { electionId: election._id.toString(), electionTitle: election.title },
    });
    await notifyEligibleStudentsForElection({
      election,
      type: "election_closed",
      title: "Election closed",
      message: `${election.title} has closed.`,
      priority: "high",
    });
    await notifyEligibleStudentsForElection({
      election,
      type: "results_published",
      title: "Results published",
      message: `Results for ${election.title} have been published.`,
      priority: "high",
    });
    await emitStudentScopedEvent({
      eventName: "report:election:closed",
      studentIds: eligibleStudentIds,
      payload: buildStudentReportElectionEventPayload(election, "closed"),
    });
    await emitAdminSchoolEvent({
      eventName: "admin:election:closed",
      schoolId: election.schoolId,
      payload: buildAdminHomeElectionEventPayload(election, "closed"),
    });
    await emitElectionMonitorUpdate(election._id.toString());

    processed.push({
      electionId: election._id.toString(),
      title: election.title,
      status: "closed",
      recipientsTargeted: students.length,
      recipientsSent: sentCount,
      failedRecipients: failedRecipients.length,
    });
  }

  return processed;
};

let intervalHandle = null;

export const processElectionLifecycle = async () => {
  const [activated, closed] = await Promise.all([
    processScheduledElections(),
    processElectionResults(),
  ]);

  return {
    activated,
    closed,
  };
};

export const startElectionResultsProcessor = () => {
  if (intervalHandle) {
    return intervalHandle;
  }

  intervalHandle = setInterval(() => {
    processElectionLifecycle().catch((error) => {
      console.error("Election results processor failed:", error.message);
    });
  }, 60 * 1000);

  return intervalHandle;
};
