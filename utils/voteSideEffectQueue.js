import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import Student from "../models/Student.js";
import Vote from "../models/Vote.js";
import VoteSideEffectJob from "../models/VoteSideEffectJob.js";
import Voter from "../models/Voter.js";
import { recordActivity } from "./activityLog.js";
import { refreshElectionAnalyticsSnapshot } from "./electionAnalytics.js";
import { emitAdminSchoolEvent, emitElectionMonitorUpdate } from "./liveMonitorSocket.js";
import { maybeNotifyTurnoutMilestone, notifyStudent } from "./notificationService.js";
import { incrementVoteCounters } from "./voteStore.js";

export const enqueueVoteSideEffects = async ({
  voteId,
  electionId,
  aspirantId,
  voterId,
  voterType = "student",
  schoolId,
  maxAttempts = 3,
}) =>
  VoteSideEffectJob.updateOne(
    { voteId },
    {
      $setOnInsert: {
        voteId,
        electionId,
        aspirantId,
        voterId,
        voterType,
        schoolId,
        maxAttempts,
      },
    },
    { upsert: true }
  );

const buildElectionLiveStatsPayload = async ({ electionId, schoolId }) => {
  const [registeredVoters, voteStats] = await Promise.all([
    Voter.countDocuments({ electionId, schoolId }),
    Vote.aggregate([
      { $match: { electionId } },
      {
        $group: {
          _id: null,
          totalVotes: { $sum: 1 },
          voters: { $addToSet: "$voterId" },
        },
      },
    ]),
  ]);

  const totalVotes = voteStats[0]?.totalVotes || 0;
  const votesCast = voteStats[0]?.voters?.length || 0;

  return {
    electionId: electionId.toString(),
    schoolId: schoolId.toString(),
    registeredVoters,
    accreditedVoters: votesCast,
    votesCast,
    totalVotes,
    ballotsCast: totalVotes,
    totalBallotsCast: totalVotes,
    turnoutPercentage:
      registeredVoters > 0 ? Number(((votesCast / registeredVoters) * 100).toFixed(1)) : 0,
    updatedAt: new Date().toISOString(),
  };
};

const emitElectionLiveStatsUpdate = async ({ electionId, schoolId }) => {
  const payload = await buildElectionLiveStatsPayload({ electionId, schoolId });
  await emitAdminSchoolEvent({
    eventName: "ec:election:stats:update",
    schoolId,
    payload,
  });
};

const runBestEffortVoteSideEffect = async (name, fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    const message = error.message || `${name} failed`;
    console.error(`Vote side effect skipped (${name}):`, message);
    return { name, error: message };
  }
};

const processVoteSideEffectJob = async (job) => {
  const [student, election, aspirant] = await Promise.all([
    Student.findById(job.voterId).select("_id firstName lastName schoolId").lean(),
    Election.findById(job.electionId).select("_id title schoolId totalVotes notifications").lean(),
    Aspirant.findById(job.aspirantId)
      .select("_id name electoralCategory categoryId voteCount")
      .lean(),
  ]);

  if (!election || !aspirant || !student) {
    throw new Error("Vote side effect context is missing");
  }

  if (!job.countersApplied) {
    await incrementVoteCounters({ election, aspirant });
    job.countersApplied = true;
    await job.save();
  }

  const warnings = [];

  warnings.push(
    await runBestEffortVoteSideEffect("activity log", () =>
      recordActivity({
        actorType: job.voterType,
        actorId: job.voterId,
        schoolId: job.schoolId,
        action: job.voterType === "ec" ? "EC Vote Cast" : "Student Vote Cast",
        metadata: { electionId: job.electionId, aspirantId: job.aspirantId },
      })
    )
  );

  if (job.voterType === "student") {
    warnings.push(
      await runBestEffortVoteSideEffect("student vote notification", () =>
        notifyStudent({
          studentId: job.voterId,
          schoolId: job.schoolId,
          type: "vote_cast_successfully",
          title: "Vote cast successfully",
          message: `Your vote for ${aspirant.name} in ${aspirant.electoralCategory} was recorded successfully.`,
          priority: "high",
          data: {
            electionId: job.electionId.toString(),
            electionTitle: election.title,
            aspirantId: job.aspirantId.toString(),
            aspirantName: aspirant.name,
            categoryId: aspirant.categoryId?.toString() || "",
            categoryTitle: aspirant.electoralCategory,
          },
        })
      )
    );
  }

  warnings.push(
    await runBestEffortVoteSideEffect("turnout milestone notification", () =>
      maybeNotifyTurnoutMilestone(job.electionId)
    )
  );
  warnings.push(
    await runBestEffortVoteSideEffect("analytics snapshot refresh", () =>
      refreshElectionAnalyticsSnapshot(election)
    )
  );
  warnings.push(
    await runBestEffortVoteSideEffect("live stats socket update", () =>
      emitElectionLiveStatsUpdate({
        electionId: job.electionId,
        schoolId: job.schoolId,
      })
    )
  );
  warnings.push(
    await runBestEffortVoteSideEffect("monitor socket update", () =>
      emitElectionMonitorUpdate(job.electionId.toString())
    )
  );

  return warnings.filter(Boolean);
};

export const processQueuedVoteSideEffectBatch = async ({ batchSize = 25 } = {}) => {
  const now = new Date();
  const jobs = await VoteSideEffectJob.find({
    status: { $in: ["queued", "failed"] },
    nextAttemptAt: { $lte: now },
    $expr: { $lt: ["$attempts", "$maxAttempts"] },
  })
    .sort({ nextAttemptAt: 1, createdAt: 1 })
    .limit(batchSize);

  const results = [];

  for (const job of jobs) {
    job.status = "processing";
    job.attempts += 1;
    await job.save();

    try {
      const warnings = await processVoteSideEffectJob(job);
      job.status = "completed";
      job.processedAt = new Date();
      job.lastError =
        warnings.length > 0
          ? `Completed with warnings: ${warnings
              .map((warning) => `${warning.name}: ${warning.error}`)
              .join("; ")}`
          : "";
      await job.save();
      results.push({
        id: job._id.toString(),
        status: "completed",
        warnings,
      });
    } catch (error) {
      job.status = job.attempts >= job.maxAttempts ? "failed" : "queued";
      job.lastError = error.message || "Vote side effect failed";
      job.nextAttemptAt = new Date(Date.now() + Math.min(job.attempts, 5) * 60 * 1000);
      await job.save();
      results.push({ id: job._id.toString(), status: job.status, error: job.lastError });
    }
  }

  return results;
};
