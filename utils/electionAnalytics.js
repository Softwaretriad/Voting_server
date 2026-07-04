import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import ElectionAnalyticsSnapshot from "../models/ElectionAnalyticsSnapshot.js";
import Student from "../models/Student.js";
import { getStoredVotesForElection } from "./voteStore.js";
import { buildAudienceStudentQuery } from "./electionAudience.js";

const getVoteStudentIdentity = (vote) =>
  vote.studentId || vote.ecUserId || vote.voterId || null;

const getAccreditedVoterKey = (vote) => {
  const identity = getVoteStudentIdentity(vote);
  return identity ? identity.toString() : null;
};

const formatHourLabel = (date) => {
  const hours = date.getUTCHours();
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}${period}`;
};

const buildTurnoutTrend = (votes, election) => {
  const sortedVotes = [...votes].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const buckets = new Map();

  sortedVotes.forEach((vote) => {
    const timestamp = new Date(vote.timestamp || election.startTime || Date.now());
    timestamp.setUTCMinutes(0, 0, 0);
    const key = timestamp.toISOString();
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });

  return Array.from(buckets.entries()).map(([key, count]) => ({
    label: formatHourLabel(new Date(key)),
    votes: count,
  }));
};

const buildVoteDistribution = ({ election, votes }) => {
  const totalVotes = votes.length;

  return (election.categories || []).map((category) => {
    const value = votes.filter(
      (vote) => vote.categoryId?.toString() === category._id.toString()
    ).length;

    return {
      label: category.title,
      value,
      percentage: totalVotes > 0 ? Number(((value / totalVotes) * 100).toFixed(1)) : 0,
    };
  });
};

const buildCategoryLeaders = ({ election, aspirants }) =>
  (election.categories || []).map((category) => {
    const categoryAspirants = aspirants
      .filter((aspirant) => aspirant.categoryId?.toString() === category._id.toString())
      .sort((a, b) => b.voteCount - a.voteCount || a.name.localeCompare(b.name));
    const ballotsCount = categoryAspirants.reduce(
      (sum, aspirant) => sum + (aspirant.voteCount || 0),
      0
    );
    const leaderVotes = categoryAspirants[0]?.voteCount || 0;
    const runnerUpVotes = categoryAspirants[1]?.voteCount || 0;

    return {
      title: category.title,
      ballotsCount,
      leadMargin:
        ballotsCount > 0
          ? Number((((leaderVotes - runnerUpVotes) / ballotsCount) * 100).toFixed(1))
          : 0,
      candidates: categoryAspirants.map((aspirant) => ({
        name: aspirant.name,
        subtitle: aspirant.programmeOfStudy || aspirant.faculty || "",
        votes: aspirant.voteCount || 0,
        percentage:
          ballotsCount > 0
            ? Number((((aspirant.voteCount || 0) / ballotsCount) * 100).toFixed(1))
            : 0,
        imageUrl: aspirant.imageUrl || "",
      })),
    };
  });

const buildFacultyVoteStatus = ({
  votes,
  students,
  registeredStudents = [],
}) => {
  const studentById = new Map(students.map((student) => [student._id.toString(), student]));
  const registeredByFaculty = new Map();
  registeredStudents.forEach((student) => {
    const faculty = student.department || "Unknown";
    registeredByFaculty.set(faculty, (registeredByFaculty.get(faculty) || 0) + 1);
  });

  const uniqueStudentVoterIds = Array.from(
    new Set(votes.map((vote) => getVoteStudentIdentity(vote)?.toString()).filter(Boolean))
  );
  const votesByFaculty = new Map();

  uniqueStudentVoterIds.forEach((studentId) => {
    const student = studentById.get(studentId);
    const faculty = student?.department || "Unknown";
    votesByFaculty.set(faculty, (votesByFaculty.get(faculty) || 0) + 1);
  });

  return Array.from(registeredByFaculty.entries())
    .map(([name, registeredCount]) => {
      const voteCount = votesByFaculty.get(name) || 0;
      return {
        name,
        turnout: registeredCount > 0 ? Number(((voteCount / registeredCount) * 100).toFixed(1)) : 0,
        votes: voteCount,
      };
    })
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
};

export const refreshElectionAnalyticsSnapshot = async (electionInput) => {
  const election =
    electionInput && typeof electionInput === "object" && electionInput._id
      ? electionInput
      : await Election.findById(electionInput);

  if (!election) {
    return null;
  }

  const audienceStudentQuery = buildAudienceStudentQuery(election);

  const [votes, students, aspirants, audienceStudents] = await Promise.all([
    getStoredVotesForElection(election),
    Student.find({ schoolId: election.schoolId }).select("_id studentId department nationality accountRole"),
    Aspirant.find({ electionId: election._id, schoolId: election.schoolId }).sort({
      electoralCategory: 1,
      voteCount: -1,
      name: 1,
    }),
    audienceStudentQuery
      ? Student.find(audienceStudentQuery).select("_id studentId department nationality accountRole")
      : Promise.resolve([]),
  ]);

  const uniqueVoters = new Set(votes.map((vote) => getAccreditedVoterKey(vote)).filter(Boolean));
  const registeredVoters = audienceStudents.length;
  const categoryTotals = Object.fromEntries(
    (election.categories || []).map((category) => [
      category._id.toString(),
      votes.filter((vote) => vote.categoryId?.toString() === category._id.toString()).length,
    ])
  );

  return ElectionAnalyticsSnapshot.findOneAndUpdate(
    { electionId: election._id },
    {
      $set: {
        electionId: election._id,
        schoolId: election.schoolId,
        status: election.status,
        totalVotes: votes.length,
        uniqueVoters: uniqueVoters.size,
        registeredVoters,
        accreditedVoters: uniqueVoters.size,
        turnoutPercentage:
          registeredVoters > 0
            ? Number(((uniqueVoters.size / registeredVoters) * 100).toFixed(1))
            : 0,
        categoryTotals,
        categoryLeaders: buildCategoryLeaders({ election, aspirants }),
        turnoutTrend: buildTurnoutTrend(votes, election),
        voteDistribution: buildVoteDistribution({ election, votes }),
        facultyVoteStatus: buildFacultyVoteStatus({
          votes,
          students,
          registeredStudents: audienceStudents,
        }),
        refreshedAt: new Date(),
      },
    },
    { new: true, upsert: true }
  );
};

export const getElectionAnalyticsSnapshot = async (electionId) =>
  ElectionAnalyticsSnapshot.findOne({ electionId }).lean();

export const refreshActiveElectionAnalyticsSnapshots = async ({
  statuses = ["active", "scheduled"],
  limit = 100,
} = {}) => {
  const elections = await Election.find({ status: { $in: statuses } })
    .sort({ startTime: 1, updatedAt: -1 })
    .limit(limit);

  const refreshed = [];
  for (const election of elections) {
    const snapshot = await refreshElectionAnalyticsSnapshot(election);
    if (snapshot) {
      refreshed.push(election._id.toString());
    }
  }

  return {
    refreshedCount: refreshed.length,
    refreshedElectionIds: refreshed,
  };
};
