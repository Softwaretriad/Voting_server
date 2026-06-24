import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import Vote from "../models/Vote.js";

const duplicateVoteCodes = new Set([11000, 11001]);

export const isDuplicateVoteError = (error) => duplicateVoteCodes.has(error?.code);

const toVoteShape = (vote) => ({
  _id: vote._id,
  candidate: vote.candidate || "",
  aspirantId: vote.aspirantId,
  electionId: vote.electionId,
  categoryId: vote.categoryId,
  categoryKey: vote.categoryKey || vote.categoryId?.toString() || "",
  voterId: vote.voterId,
  studentId: vote.studentId || null,
  ecUserId: vote.ecUserId || null,
  voterType: vote.voterType,
  timestamp: vote.legacyTimestamp || vote.createdAt || vote.timestamp || new Date(),
  createdAt: vote.createdAt || vote.legacyTimestamp || vote.timestamp || new Date(),
});

export const getStoredVotesForElection = async (election) => {
  const electionId = election?._id || election;
  if (!electionId) {
    return [];
  }

  const storedVotes = await Vote.find({ electionId }).sort({ createdAt: 1 }).lean();
  return storedVotes.map(toVoteShape);
};

export const getStoredVoteCountForElection = async (election) => {
  const electionId = election?._id || election;
  if (!electionId) {
    return 0;
  }

  const count = await Vote.countDocuments({ electionId });
  return count || election?.totalVotes || 0;
};

export const hasVoterVotedInCategory = async ({ election, voterId, categoryId }) => {
  const categoryKey = String(categoryId || "");
  if (!election?._id || !voterId || !categoryKey) {
    return false;
  }

  const existingVote = await Vote.exists({
    electionId: election._id,
    voterId,
    categoryKey,
  });
  if (existingVote) {
    return true;
  }

  return false;
};

export const incrementVoteCounters = async ({ election, aspirant }) => {
  await Promise.all([
    Aspirant.updateOne({ _id: aspirant._id }, { $inc: { voteCount: 1 } }),
    Election.updateOne({ _id: election._id }, { $inc: { totalVotes: 1 } }),
  ]);

  aspirant.voteCount = (aspirant.voteCount || 0) + 1;
  election.totalVotes = (election.totalVotes || 0) + 1;
};

export const castStoredVote = async ({
  election,
  aspirant,
  voterType,
  voterId,
  schoolId,
  updateCounters = true,
}) => {
  const candidate = `${aspirant.name} - ${aspirant.electoralCategory}`;
  const categoryKey = String(aspirant.categoryId || aspirant.electoralCategory || "");
  const vote = await Vote.create({
    schoolId,
    electionId: election._id,
    categoryId: aspirant.categoryId,
    categoryKey,
    aspirantId: aspirant._id,
    voterType,
    voterId,
    studentId: voterType === "student" ? voterId : null,
    ecUserId: voterType === "ec" ? voterId : null,
    candidate,
  });

  if (updateCounters) {
    await incrementVoteCounters({ election, aspirant });
  }

  return toVoteShape(vote.toObject());
};
