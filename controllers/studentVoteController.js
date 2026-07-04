import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";
import sendEmail from "../utils/sendEmail.js";
import { createOtp, getOtpExpiry } from "../utils/studentAuth.js";
import {
  comparePin,
  compareSecret,
  createOpaqueToken,
  hashSecret,
  isFourDigitPin,
  normalizeEmail,
} from "../utils/security.js";
import { recordActivity } from "../utils/activityLog.js";
import { emitElectionMonitorUpdate } from "../utils/liveMonitorSocket.js";
import { isStudentEligibleForElection } from "../utils/electionEligibility.js";
import { getCacheJson, setCacheJson } from "../utils/redisClient.js";
import { enqueueVoteSideEffects } from "../utils/voteSideEffectQueue.js";
import {
  castStoredVote,
  incrementVoteCounters,
  isDuplicateVoteError,
} from "../utils/voteStore.js";
import {
  maybeNotifyTurnoutMilestone,
  notifySchoolAdmins,
  notifyStudent,
} from "../utils/notificationService.js";
import { refreshElectionAnalyticsSnapshot } from "../utils/electionAnalytics.js";
import { recordVoteCastMetric } from "../utils/runtimeMetrics.js";

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 10;
const POST_VOTE_SIDE_EFFECT_CONCURRENCY = Math.max(
  1,
  Number(process.env.POST_VOTE_SIDE_EFFECT_CONCURRENCY || 1)
);
const VOTE_TARGET_CACHE_TTL_SECONDS = Number(process.env.VOTE_TARGET_CACHE_TTL_SECONDS || 5);
const VOTE_ELIGIBILITY_CACHE_TTL_SECONDS = Number(
  process.env.VOTE_ELIGIBILITY_CACHE_TTL_SECONDS || 30
);
const VOTE_TARGET_LOCAL_CACHE_TTL_MS = VOTE_TARGET_CACHE_TTL_SECONDS * 1000;
const postVoteSideEffectQueue = [];
let activePostVoteSideEffects = 0;
const voteTargetLocalCache = new Map();

const createVoteTiming = () => {
  const isDebugEnabled = process.env.VOTE_TIMING_DEBUG === "true";
  const startedAt = performance.now();
  let lastAt = startedAt;
  const marks = [];

  return {
    mark: (name) => {
      if (!isDebugEnabled) {
        return;
      }

      const now = performance.now();
      marks.push({
        name,
        durationMs: Math.round((now - lastAt) * 100) / 100,
        totalMs: Math.round((now - startedAt) * 100) / 100,
      });
      lastAt = now;
    },
    flush: ({ status, electionId, aspirantId, studentId }) => {
      const totalMs = Math.round((performance.now() - startedAt) * 100) / 100;
      recordVoteCastMetric({ durationMs: totalMs });
      if (!isDebugEnabled) {
        return;
      }

      console.log("Vote timing", {
        status,
        electionId,
        aspirantId,
        studentId,
        totalMs,
        marks,
      });
    },
  };
};

const runPostVoteSideEffects = async ({
  student,
  election,
  aspirant,
  aspirantCategoryId,
}) => {
  try {
    await incrementVoteCounters({ election, aspirant });
    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Student Vote Cast",
      metadata: { electionId: election._id, aspirantId: aspirant._id },
    });
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "vote_cast_successfully",
      title: "Vote cast successfully",
      message: `Your vote for ${aspirant.name} in ${aspirant.electoralCategory} was recorded successfully.`,
      priority: "high",
      data: {
        electionId: election._id.toString(),
        electionTitle: election.title,
        aspirantId: aspirant._id.toString(),
        aspirantName: aspirant.name,
        categoryId: aspirantCategoryId,
        categoryTitle: aspirant.electoralCategory,
      },
    });
    await maybeNotifyTurnoutMilestone(election);
    await refreshElectionAnalyticsSnapshot(election);
    await emitElectionMonitorUpdate(election._id.toString());
  } catch (error) {
    console.error("Post-vote side effects failed:", error.message);
  }
};

const processPostVoteSideEffectQueue = () => {
  while (
    activePostVoteSideEffects < POST_VOTE_SIDE_EFFECT_CONCURRENCY &&
    postVoteSideEffectQueue.length > 0
  ) {
    const job = postVoteSideEffectQueue.shift();
    activePostVoteSideEffects += 1;

    setImmediate(() => {
      runPostVoteSideEffects(job)
        .catch((error) => {
          console.error("Post-vote side effect queue failed:", error.message);
        })
        .finally(() => {
          activePostVoteSideEffects -= 1;
          processPostVoteSideEffectQueue();
        });
    });
  }
};

const enqueuePostVoteSideEffects = (job) => {
  if (process.env.POST_VOTE_SIDE_EFFECTS_ENABLED === "false") {
    return;
  }

  if (process.env.POST_VOTE_SIDE_EFFECT_MODE === "queue") {
    enqueueVoteSideEffects({
      voteId: job.voteId,
      electionId: job.election._id,
      aspirantId: job.aspirant._id,
      voterId: job.student._id,
      voterType: "student",
      schoolId: job.student.schoolId,
    }).catch((error) => {
      console.error("Failed to enqueue vote side effects:", error.message);
    });
    return;
  }

  postVoteSideEffectQueue.push(job);
  processPostVoteSideEffectQueue();
};

const getVoteTargetCacheKey = ({ electionId, aspirantId }) =>
  `vote-target:${electionId}:${aspirantId}`;

const getEligibilityCacheKey = ({ electionId, student }) =>
  `vote-eligibility:${electionId}:${student.schoolId?.toString?.() || "none"}:${student.studentId}`;

const loadVoteTargetContext = async ({ electionId, aspirantId, cacheKey }) => {
  const cached = await getCacheJson(cacheKey);
  if (cached?.election && cached?.aspirant) {
    return cached;
  }

  const [election, aspirant] = await Promise.all([
    Election.findById(electionId)
      .select("_id schoolId status endTime audience title totalVotes")
      .lean(),
    Aspirant.findOne({
      _id: aspirantId,
      electionId,
    })
      .select("_id schoolId electionId categoryId name electoralCategory voteCount")
      .lean(),
  ]);

  const context = { election, aspirant };
  if (election && aspirant) {
    await setCacheJson(cacheKey, context, VOTE_TARGET_CACHE_TTL_SECONDS);
  }

  return context;
};

const getVoteTargetContext = async ({ electionId, aspirantId }) => {
  const cacheKey = getVoteTargetCacheKey({ electionId, aspirantId });
  const localCached = voteTargetLocalCache.get(cacheKey);
  if (localCached && localCached.expiresAt > Date.now()) {
    return localCached.promise;
  }

  const promise = loadVoteTargetContext({ electionId, aspirantId, cacheKey }).catch(
    (error) => {
      voteTargetLocalCache.delete(cacheKey);
      throw error;
    }
  );

  voteTargetLocalCache.set(cacheKey, {
    promise,
    expiresAt: Date.now() + VOTE_TARGET_LOCAL_CACHE_TTL_MS,
  });

  return promise;
};

const isEligibleForVote = async ({ election, student }) => {
  const cacheKey = getEligibilityCacheKey({ electionId: election._id, student });
  const cached = await getCacheJson(cacheKey);
  if (cached?.eligible === true) {
    return true;
  }

  const eligible = await isStudentEligibleForElection({ election, student });
  if (eligible) {
    await setCacheJson(cacheKey, { eligible: true }, VOTE_ELIGIBILITY_CACHE_TTL_SECONDS);
  }

  return eligible;
};

const resetPinValidationError = (pin) => {
  if (!isFourDigitPin(pin)) {
    return "newPin must be exactly 4 digits";
  }
  return null;
};

const votingPinRequiredResponse = (res) =>
  sendError(res, 409, "Voting PIN setup is required before voting", {
    code: "VOTING_PIN_REQUIRED",
    requiresVotingPinSetup: true,
  });

export const setVotingPin = async (req, res) => {
  try {
    const { newPin } = req.body || {};
    if (req.params?.userId && req.student._id.toString() !== req.params.userId) {
      return sendError(res, 403, "You are not allowed to create this voting PIN");
    }

    const pinError = resetPinValidationError(newPin);
    if (pinError) {
      return sendError(res, 422, pinError);
    }

    const student = await Student.findById(req.student._id);
    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    if (student.votingPin) {
      return sendError(res, 409, "Voting PIN already exists. Use PIN reset to change it.");
    }

    student.votingPin = String(newPin);
    student.votingPinAttempts = 0;
    student.votingPinLockedUntil = null;
    await student.save();

    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Voting PIN Created",
    });

    return res.status(201).json({
      hasVotingPin: true,
      message: "Voting PIN created successfully",
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to create voting PIN");
  }
};

export const verifyVotingPin = async (req, res) => {
  try {
    const { studentId, votingPin } = req.body;
    const student = await Student.findById(studentId);

    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    if (req.student._id.toString() !== studentId) {
      return sendError(res, 403, "You are not allowed to verify this PIN");
    }

    if (!student.votingPin) {
      return votingPinRequiredResponse(res);
    }

    if (student.votingPinLockedUntil && student.votingPinLockedUntil > new Date()) {
      return sendError(res, 429, "Too many failed attempts. Please try again later.");
    }

    if (!(await comparePin(votingPin, student.votingPin))) {
      student.votingPinAttempts += 1;
      if (student.votingPinAttempts >= MAX_PIN_ATTEMPTS) {
        student.votingPinLockedUntil = new Date(
          Date.now() + PIN_LOCK_MINUTES * 60 * 1000
        );
        await notifySchoolAdmins({
          schoolId: student.schoolId,
          type: "suspicious_voting_activity",
          title: "Repeated failed voting PIN attempts",
          message: `${student.firstName} ${student.lastName} triggered repeated failed voting PIN attempts.`,
          priority: "high",
          data: {
            studentId: student._id.toString(),
            attempts: student.votingPinAttempts,
          },
        });
      }
      await student.save();
      return sendError(res, 400, "Incorrect voting PIN. Please try again.");
    }

    student.votingPinAttempts = 0;
    student.votingPinLockedUntil = null;
    await student.save();

    return res.status(200).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to verify voting PIN");
  }
};

export const castStudentVote = async (req, res) => {
  const timing = createVoteTiming();
  try {
    const { studentId, electionId, aspirantId, votingPin } = req.body;

    if (req.student._id.toString() !== studentId) {
      return sendError(res, 403, "You are not allowed to cast this vote");
    }

    const { election, aspirant } = await getVoteTargetContext({ electionId, aspirantId });
    timing.mark("load vote target");

    const student = req.student;

    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    if (
      student.schoolId &&
      election.schoolId?.toString() !== student.schoolId.toString()
    ) {
      return sendError(res, 403, "You are not allowed to vote in this election");
    }

    const isEligible = await isEligibleForVote({
      election,
      student,
    });
    timing.mark("eligibility");
    if (!isEligible) {
      return sendError(res, 403, "You are not eligible to vote in this election");
    }

    if (election.status !== "active" || new Date() > new Date(election.endTime)) {
      return sendError(res, 403, "Election is not active");
    }

    if (!aspirant) {
      return sendError(res, 404, "Aspirant not found");
    }

    if (
      student.schoolId &&
      aspirant.schoolId?.toString() !== student.schoolId.toString()
    ) {
      return sendError(res, 403, "Aspirant does not belong to your school");
    }

    const aspirantCategoryId = aspirant.categoryId?.toString();
    if (!student.votingPin) {
      return votingPinRequiredResponse(res);
    }
    if (votingPin == null) {
      return sendError(res, 400, "votingPin is required");
    }
    if (!(await comparePin(votingPin, student.votingPin))) {
      timing.mark("pin check");
      return sendError(res, 400, "Invalid voting PIN");
    }
    timing.mark("pin check");

    let vote = null;
    try {
      vote = await castStoredVote({
        election,
        aspirant,
        voterType: "student",
        voterId: student._id,
        schoolId: student.schoolId,
        updateCounters: false,
      });
      timing.mark("vote insert");
    } catch (error) {
      if (isDuplicateVoteError(error)) {
        timing.mark("duplicate insert");
        timing.flush({ status: 409, electionId, aspirantId, studentId });
        return sendError(
          res,
          409,
          "You have already cast your vote for this category."
        );
      }
      throw error;
    }

    res.status(201).json({});
    timing.flush({ status: 201, electionId, aspirantId, studentId });
    enqueuePostVoteSideEffects({
      voteId: vote._id,
      student,
      election,
      aspirant,
      aspirantCategoryId,
    });
    return undefined;
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to cast vote");
  }
};

export const forgotVotingPin = async (req, res) => {
  try {
    const { email } = req.body;
    const student = await Student.findOne({ email: normalizeEmail(email) });

    if (!student) {
      return res.status(200).json({});
    }

    const otp = createOtp();
    student.votingPinResetOtp = await hashSecret(otp);
    student.votingPinResetOtpExpires = getOtpExpiry();
    await student.save();

    await sendEmail(
      student.email,
      "Reset your MyUniVote voting PIN",
      `Your MyUniVote voting PIN reset code is ${otp}. It expires in 10 minutes.`
    );

    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Voting PIN Reset Requested",
    });
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "voting_pin_reset_requested",
      title: "Voting PIN reset requested",
      message: "A voting PIN reset OTP has been sent to your email.",
      priority: "high",
    });

    return res.status(200).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to start voting PIN reset");
  }
};

export const verifyVotingPinResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const student = await Student.findOne({
      email: normalizeEmail(email),
    });

    if (
      !student ||
      !(await compareSecret(otp, student.votingPinResetOtp)) ||
      !student.votingPinResetOtpExpires ||
      student.votingPinResetOtpExpires < new Date()
    ) {
      return sendError(res, 400, "This code is incorrect or has expired.");
    }

    student.votingPinResetOtp = null;
    student.votingPinResetOtpExpires = null;
    const resetToken = createOpaqueToken();
    student.votingPinResetTokenHash = await hashSecret(resetToken);
    student.votingPinResetTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
    await student.save();

    return res.status(200).json({
      resetToken,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to verify voting PIN reset OTP");
  }
};

export const resetVotingPin = async (req, res) => {
  try {
    const { resetToken, newPin } = req.body;

    if (!resetToken) {
      return sendError(res, 400, "resetToken is required");
    }

    const pinError = resetPinValidationError(newPin);
    if (pinError) {
      return sendError(res, 422, pinError);
    }

    const students = await Student.find({
      votingPinResetTokenExpires: { $gt: new Date() },
    });

    let student = null;
    for (const candidate of students) {
      if (await compareSecret(resetToken, candidate.votingPinResetTokenHash)) {
        student = candidate;
        break;
      }
    }

    if (!student) {
      return sendError(res, 400, "Invalid or expired resetToken");
    }

    student.votingPin = String(newPin);
    student.votingPinResetTokenHash = null;
    student.votingPinResetTokenExpires = null;
    student.votingPinAttempts = 0;
    student.votingPinLockedUntil = null;
    await student.save();

    await recordActivity({
      actorType: "student",
      actorId: student._id,
      schoolId: student.schoolId,
      action: "Voting PIN Reset Completed",
    });
    await notifyStudent({
      studentId: student._id,
      schoolId: student.schoolId,
      type: "voting_pin_reset_completed",
      title: "Voting PIN reset completed",
      message: "Your voting PIN has been changed successfully.",
      priority: "high",
    });

    return res.status(200).json({});
  } catch {
    return sendError(res, 400, "Invalid or expired resetToken");
  }
};
