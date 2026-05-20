import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import { sendError } from "../utils/apiResponse.js";
import { recordActivity } from "../utils/activityLog.js";
import { isStudentRegistryIdInElectionVoters } from "../utils/electionEligibility.js";
import { emitElectionMonitorUpdate } from "../utils/liveMonitorSocket.js";
import { hasAdminVotedInCategory } from "../utils/voteState.js";
import { maybeNotifyTurnoutMilestone } from "../utils/notificationService.js";

export const castAdminVote = async (req, res) => {
  try {
    const { adminUserId, electionId, aspirantId } = req.body;

    if (req.ecUser._id.toString() !== String(adminUserId || "")) {
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

    const hasVotedInCategory = hasAdminVotedInCategory({
      election,
      adminId: req.ecUser._id,
      categoryId: aspirant.categoryId,
    });

    if (hasVotedInCategory) {
      return sendError(
        res,
        409,
        "You have already cast your vote for this category."
      );
    }

    aspirant.voteCount = (aspirant.voteCount || 0) + 1;
    await aspirant.save();

    election.votes.push({
      candidate: `${aspirant.name} - ${aspirant.electoralCategory}`,
      aspirantId: aspirant._id,
      electionId: election._id,
      categoryId: aspirant.categoryId,
      adminId: req.ecUser._id,
    });
    await election.save();

    await recordActivity({
      actorType: "admin",
      actorId: req.ecUser._id,
      schoolId: req.schoolId,
      action: "Admin Vote Cast",
      metadata: { electionId: election._id, aspirantId: aspirant._id },
    });
    await maybeNotifyTurnoutMilestone(election);
    await emitElectionMonitorUpdate(election._id.toString());

    return res.status(201).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to cast vote");
  }
};

export const getAdminVoteHistory = async (req, res) => {
  try {
    const { adminUserId } = req.params;

    if (req.ecUser._id.toString() !== adminUserId) {
      return sendError(res, 403, "You are not allowed to access this vote history");
    }

    const elections = await Election.find({
      "votes.adminId": req.ecUser._id,
      schoolId: req.schoolId,
    }).sort({ startTime: -1, createdAt: -1 });

    const groupedHistory = new Map();

    elections.forEach((election) => {
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
      adminUserId: req.ecUser._id.toString(),
      years,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load admin vote history");
  }
};
