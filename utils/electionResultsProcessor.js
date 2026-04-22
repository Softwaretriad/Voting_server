import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import School from "../models/school.js";
import Student from "../models/Student.js";
import sendEmail from "./sendEmail.js";
import { createElectionResultsPdfBuffer } from "./pdfResults.js";
import { syncSchoolSubscriptionState } from "./plans.js";

const MAX_EMAIL_ATTEMPTS = 3;

const getElectionDateLabel = (election) => {
  const start = election.startTime
    ? new Date(election.startTime).toISOString().slice(0, 10)
    : "Unknown";
  const end = election.endTime
    ? new Date(election.endTime).toISOString().slice(0, 10)
    : start;

  return start === end ? start : `${start} to ${end}`;
};

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
    await election.save();

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
    if (school?.subscriptionTerm === "one_off_election") {
      school.oneOffElectionConsumed = true;
      school.subscriptionActive = false;
      school.subscriptionExpiresAt = new Date();
      syncSchoolSubscriptionState(school);
      await school.save();
    }
    await election.save();

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
