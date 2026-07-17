import Election from "../models/Election.js";
import School from "../models/school.js";
import {
  emitAdminSchoolEvent,
  emitElectionMonitorUpdate,
  emitStudentScopedEvent,
} from "./liveMonitorSocket.js";
import { syncSchoolSubscriptionState } from "./plans.js";
import {
  getEligibleStudentObjectIdsForElection,
  notifyEligibleStudentsForElection,
  notifySchoolAdmins,
} from "./notificationService.js";
import { withDistributedJobLock } from "./jobLock.js";
import { refreshElectionAnalyticsSnapshot } from "./electionAnalytics.js";
import { ensureMongoConnected } from "./mongoConnection.js";
import { markWorkerFailure, markWorkerSuccess } from "./workerHeartbeat.js";

const STARTING_SOON_WINDOW_MS = 60 * 60 * 1000;
const CLOSING_SOON_WINDOW_MS = 60 * 60 * 1000;
const LIFECYCLE_POLL_INTERVAL_MS = Number(process.env.ELECTION_LIFECYCLE_INTERVAL_MS || 15000);

const logLifecycleSideEffectError = (context, error) => {
  console.error("Election lifecycle side effect failed:", {
    context,
    message: error?.message || "Unknown error",
    code: error?.code || null,
    command: error?.command || null,
  });
};

const runLifecycleSideEffect = async (context, task) => {
  try {
    return await task();
  } catch (error) {
    logLifecycleSideEffectError(context, error);
    return null;
  }
};

const buildStudentHomeElectionEventPayload = (election, statusOverride = null) => ({
  electionId: election._id.toString(),
  status: statusOverride || election.status,
  title: election.title,
  imageUrl: election.imageUrl || "",
  schoolId: election.schoolId?.toString?.() || election.schoolId,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
  listScope:
    (statusOverride || election.status) === "scheduled"
      ? "schedule"
      : (statusOverride || election.status) === "active"
        ? "active"
        : "results",
  isScheduled: (statusOverride || election.status) === "scheduled",
  isActive: (statusOverride || election.status) === "active",
});

const buildStudentReportElectionEventPayload = (election, statusOverride = null) => ({
  electionId: election._id.toString(),
  status: statusOverride || election.status,
  title: election.title,
  imageUrl: election.imageUrl || "",
  schoolId: election.schoolId?.toString?.() || election.schoolId,
});

const buildAdminHomeElectionMetricsPayload = (analyticsSnapshot = null) => {
  if (!analyticsSnapshot) {
    return {};
  }

  const ballotsCast = Number(analyticsSnapshot.totalVotes || 0);
  const accreditedVoters = Number(analyticsSnapshot.accreditedVoters || 0);

  return {
    votesCast: accreditedVoters,
    totalVotes: ballotsCast,
    accreditedVoters,
    ballotsCast,
    totalBallotsCast: ballotsCast,
    registeredVoters: Number(analyticsSnapshot.registeredVoters || 0),
    turnoutPercentage: Number(analyticsSnapshot.turnoutPercentage || 0),
    updatedAt: analyticsSnapshot.refreshedAt
      ? new Date(analyticsSnapshot.refreshedAt).toISOString()
      : new Date().toISOString(),
  };
};

const buildAdminHomeElectionEventPayload = (
  election,
  statusOverride = null,
  analyticsSnapshot = null
) => ({
  electionId: election._id.toString(),
  status: statusOverride || election.status,
  title: election.title,
  imageUrl: election.imageUrl || "",
  schoolId: election.schoolId?.toString?.() || election.schoolId,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
  ...buildAdminHomeElectionMetricsPayload(analyticsSnapshot),
});

export const processScheduledElections = async ({ forceElectionIds = [] } = {}) => {
  const now = new Date();
  const startingSoonBoundary = new Date(now.getTime() + STARTING_SOON_WINDOW_MS);
  const startingSoonElections = await Election.find({
    status: "scheduled",
    startTime: { $gt: now, $lte: startingSoonBoundary },
    "notifications.startingSoonSentAt": null,
  });

  for (const election of startingSoonElections) {
    await runLifecycleSideEffect(
      `starting-soon notification ${election._id}`,
      () =>
        notifyEligibleStudentsForElection({
          election,
          type: "election_starting_soon",
          title: "Election starting soon",
          message: `${election.title} starts within the next hour.`,
          priority: "high",
        })
    );
    election.notifications = {
      ...(election.notifications || {}),
      startingSoonSentAt: new Date(),
    };
    await election.save();
    await runLifecycleSideEffect(`analytics refresh ${election._id}`, () =>
      refreshElectionAnalyticsSnapshot(election)
    );
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
    const analyticsSnapshot = await runLifecycleSideEffect(
      `analytics refresh ${election._id}`,
      () => refreshElectionAnalyticsSnapshot(election)
    );
    const eligibleStudentIds = await getEligibleStudentObjectIdsForElection(election);
    await runLifecycleSideEffect(`ec live notification ${election._id}`, () =>
      notifySchoolAdmins({
        schoolId: election.schoolId,
        type: "election_went_live",
        title: "Election is now live",
        message: `${election.title} is now live.`,
        priority: "high",
        data: { electionId: election._id.toString(), electionTitle: election.title },
      })
    );
    await runLifecycleSideEffect(`student live notification ${election._id}`, () =>
      notifyEligibleStudentsForElection({
        election,
        type: "election_is_now_live",
        title: "Election is now live",
        message: `${election.title} is now live.`,
        priority: "high",
      })
    );
    await runLifecycleSideEffect(`student activated socket ${election._id}`, () =>
      emitStudentScopedEvent({
        eventName: "election:activated",
        studentIds: eligibleStudentIds,
        payload: buildStudentHomeElectionEventPayload(election, "active"),
      })
    );
    await runLifecycleSideEffect(`ec activated socket ${election._id}`, () =>
      emitAdminSchoolEvent({
        eventName: "ec:election:activated",
        schoolId: election.schoolId,
        payload: buildAdminHomeElectionEventPayload(election, "active", analyticsSnapshot),
      })
    );
    await runLifecycleSideEffect(`report activated socket ${election._id}`, () =>
      emitStudentScopedEvent({
        eventName: "report:election:activated",
        studentIds: eligibleStudentIds,
        payload: buildStudentReportElectionEventPayload(election, "active"),
      })
    );
    await runLifecycleSideEffect(`monitor activated update ${election._id}`, () =>
      emitElectionMonitorUpdate(election._id.toString())
    );

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
    await runLifecycleSideEffect(
      `closing-soon notification ${election._id}`,
      () =>
        notifyEligibleStudentsForElection({
          election,
          type: "election_closing_soon",
          title: "Election closing soon",
          message: `${election.title} closes within the next hour.`,
          priority: "high",
        })
    );
    election.notifications = {
      ...(election.notifications || {}),
      closingSoonSentAt: new Date(),
    };
    await election.save();
  }

  const filter =
    forceElectionIds.length > 0
      ? { _id: { $in: forceElectionIds } }
      : { status: { $in: ["active", "scheduled"] }, endTime: { $lte: now } };

  const elections = await Election.find(filter);
  const processed = [];

  for (const pendingElection of elections) {
    const election = await Election.findOneAndUpdate(
      {
        _id: pendingElection._id,
        status: { $in: ["active", "scheduled"] },
        endTime: { $lte: now },
      },
      {
        $set: {
          status: "closed",
          "notifications.closedSentAt": pendingElection.notifications?.closedSentAt || new Date(),
          "notifications.resultsPublishedSentAt":
            pendingElection.notifications?.resultsPublishedSentAt || new Date(),
        },
      },
      { new: true }
    );

    if (!election) {
      processed.push({
        electionId: pendingElection._id.toString(),
        title: pendingElection.title,
        status: "already_claimed_or_not_elapsed",
      });
      continue;
    }

    const school = await School.findById(election.schoolId);
    election.status = "closed";
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
    await runLifecycleSideEffect(`ec closed notification ${election._id}`, () =>
      notifySchoolAdmins({
        schoolId: election.schoolId,
        type: "election_closed",
        title: "Election closed",
        message: `${election.title} has closed.`,
        priority: "high",
        data: { electionId: election._id.toString(), electionTitle: election.title },
      })
    );
    await runLifecycleSideEffect(`ec results-generated notification ${election._id}`, () =>
      notifySchoolAdmins({
        schoolId: election.schoolId,
        type: "results_generated",
        title: "Results generated",
        message: `Results were generated for ${election.title}.`,
        priority: "high",
        data: { electionId: election._id.toString(), electionTitle: election.title },
      })
    );
    await runLifecycleSideEffect(`ec report-ready notification ${election._id}`, () =>
      notifySchoolAdmins({
        schoolId: election.schoolId,
        type: "results_report_ready",
        title: "Results report ready",
        message: `The results report for ${election.title} is ready.`,
        priority: "high",
        data: { electionId: election._id.toString(), electionTitle: election.title },
      })
    );
    await runLifecycleSideEffect(`student closed notification ${election._id}`, () =>
      notifyEligibleStudentsForElection({
        election,
        type: "election_closed",
        title: "Election closed",
        message: `${election.title} has closed.`,
        priority: "high",
      })
    );
    await runLifecycleSideEffect(`student results notification ${election._id}`, () =>
      notifyEligibleStudentsForElection({
        election,
        type: "results_published",
        title: "Results published",
        message: `Results for ${election.title} have been published.`,
        priority: "high",
      })
    );
    await runLifecycleSideEffect(`report closed socket ${election._id}`, () =>
      emitStudentScopedEvent({
        eventName: "report:election:closed",
        studentIds: eligibleStudentIds,
        payload: buildStudentReportElectionEventPayload(election, "closed"),
      })
    );
    await runLifecycleSideEffect(`ec closed socket ${election._id}`, () =>
      emitAdminSchoolEvent({
        eventName: "ec:election:closed",
        schoolId: election.schoolId,
        payload: buildAdminHomeElectionEventPayload(election, "closed"),
      })
    );
    await runLifecycleSideEffect(`monitor closed update ${election._id}`, () =>
      emitElectionMonitorUpdate(election._id.toString())
    );

    processed.push({
      electionId: election._id.toString(),
      title: election.title,
      status: "closed",
    });
  }

  return processed;
};

let intervalHandle = null;

export const processElectionLifecycle = async () => {
  await ensureMongoConnected();

  const { acquired, result } = await withDistributedJobLock({
    key: "election-lifecycle",
    ttlMs: Math.max(LIFECYCLE_POLL_INTERVAL_MS * 2, 30000),
    task: async () => Promise.allSettled([processScheduledElections(), processElectionResults()]),
  });

  if (!acquired) {
    return {
      activated: [],
      closed: [],
      skipped: "election lifecycle lock is held by another worker",
    };
  }

  const [activatedResult, closedResult] = result;

  return {
    activated: activatedResult.status === "fulfilled" ? activatedResult.value : [],
    closed: closedResult.status === "fulfilled" ? closedResult.value : [],
    errors: [activatedResult, closedResult]
      .filter((entry) => entry.status === "rejected")
      .map((entry) => entry.reason?.message || "Election lifecycle task failed"),
  };
};

export const startElectionResultsProcessor = () => {
  if (process.env.ELECTION_LIFECYCLE_ENABLED === "false") {
    return null;
  }

  if (intervalHandle) {
    return intervalHandle;
  }

  intervalHandle = setInterval(() => {
    const startedAt = Date.now();
    processElectionLifecycle()
      .then((result) =>
        markWorkerSuccess({
          workerName: "election-lifecycle",
          durationMs: Date.now() - startedAt,
          intervalMs: LIFECYCLE_POLL_INTERVAL_MS,
          result,
        })
      )
      .catch(async (error) => {
        await markWorkerFailure({
          workerName: "election-lifecycle",
          durationMs: Date.now() - startedAt,
          intervalMs: LIFECYCLE_POLL_INTERVAL_MS,
          error,
        }).catch(() => null);
        console.error("Election results processor failed:", error.message);
      });
  }, LIFECYCLE_POLL_INTERVAL_MS);

  return intervalHandle;
};
