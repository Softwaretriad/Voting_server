import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import { sendError } from "../utils/apiResponse.js";
import { recordActivity } from "../utils/activityLog.js";
import { isStudentRegistryIdInElectionVoters } from "../utils/electionEligibility.js";
import { emitElectionMonitorUpdate } from "../utils/liveMonitorSocket.js";
import {
  castStoredVote,
  getStoredVotesForElection,
  hasVoterVotedInCategory,
  isDuplicateVoteError,
} from "../utils/voteStore.js";
import { maybeNotifyTurnoutMilestone } from "../utils/notificationService.js";
import { refreshElectionAnalyticsSnapshot } from "../utils/electionAnalytics.js";
import { EC_ROLE } from "../utils/ecRole.js";

export const castAdminVote = async (req, res) => {
  try {
    const { ecUserId, electionId, aspirantId } = req.body;
    const resolvedEcUserId = String(ecUserId || "");

    if (req.ecUser._id.toString() !== resolvedEcUserId) {
      return sendError(res, 403, "You are not allowed to cast this vote");
    }

    const election = await Election.findById(electionId);
    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    if (election.schoolId?.toString() !== req.schoolId?.toString()) {
      return sendError(res, 403, "You are not allowed to vote in this election");
    }

    if (election.status !== "active" || new Date() > election.endTime) {
      return sendError(res, 403, "Election is not active");
    }

    const isInVotersList = await isStudentRegistryIdInElectionVoters({
      election,
      schoolId: req.schoolId,
      studentRegistryId: req.ecUser?.studentId,
    });
    if (!isInVotersList) {
      return sendError(
        res,
        403,
        "You must be included in the voters list to vote in this election"
      );
    }

    const aspirant = await Aspirant.findOne({
      _id: aspirantId,
      electionId,
      schoolId: req.schoolId,
    });

    if (!aspirant) {
      return sendError(res, 404, "Aspirant not found");
    }

    const hasVotedInCategory = await hasVoterVotedInCategory({
      election,
      voterId: req.ecUser._id,
      categoryId: aspirant.categoryId,
    });

    if (hasVotedInCategory) {
      return sendError(
        res,
        409,
        "You have already cast your vote for this category."
      );
    }

    try {
      await castStoredVote({
        election,
        aspirant,
        voterType: "ec",
        voterId: req.ecUser._id,
        schoolId: req.schoolId,
      });
    } catch (error) {
      if (isDuplicateVoteError(error)) {
        return sendError(
          res,
          409,
          "You have already cast your vote for this category."
        );
      }
      throw error;
    }

    await recordActivity({
      actorType: EC_ROLE,
      actorId: req.ecUser._id,
      schoolId: req.schoolId,
      action: "EC Vote Cast",
      metadata: { electionId: election._id, aspirantId: aspirant._id },
    });
    await maybeNotifyTurnoutMilestone(election);
    await refreshElectionAnalyticsSnapshot(election);
    await emitElectionMonitorUpdate(election._id.toString());

    return res.status(201).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to cast vote");
  }
};

export const getAdminVoteHistory = async (req, res) => {
  try {
    const { ecUserId } = req.params;

    if (req.ecUser._id.toString() !== ecUserId) {
      return sendError(res, 403, "You are not allowed to access this vote history");
    }

    const elections = await Election.find({ schoolId: req.schoolId }).sort({
      startTime: -1,
      createdAt: -1,
    });
    const electionVotePairs = await Promise.all(
      elections.map(async (election) => ({
        election,
        votes: await getStoredVotesForElection(election),
      }))
    );

    const groupedHistory = new Map();

    electionVotePairs.forEach(({ election, votes }) => {
      const hasVoted = votes.some((vote) => {
        const ecVoteId = vote.ecUserId || vote.voterId;
        return ecVoteId?.toString() === req.ecUser._id.toString();
      });
      if (!hasVoted) {
        return;
      }

      const startDate = election.startTime || election.endTime || election.createdAt;
      const year = startDate ? new Date(startDate).getUTCFullYear() : new Date().getUTCFullYear();

      if (!groupedHistory.has(year)) {
        groupedHistory.set(year, []);
      }

      groupedHistory.get(year).push({
        _id: election._id.toString(),
        electionName: election.title,
        voteStatus: "voted",
        hasVoted: true,
        categoriesCount: election.categories?.length || 0,
        electionStartedAt: election.startTime ? election.startTime.toISOString() : null,
      });
    });

    const years = Array.from(groupedHistory.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, items]) => ({
        year,
        elections: items.sort((a, b) => {
          const aTime = a.electionStartedAt ? new Date(a.electionStartedAt).getTime() : 0;
          const bTime = b.electionStartedAt ? new Date(b.electionStartedAt).getTime() : 0;
          return bTime - aTime;
        }),
      }));

    return res.status(200).json({
      ecUserId: req.ecUser._id.toString(),
      years,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load EC vote history");
  }
};
