import ActivityLog from "../models/ActivityLog.js";
import Aspirant from "../models/Aspirant.js";
import ECUser from "../models/ECUser.js";
import Election from "../models/Election.js";
import School from "../models/school.js";
import Student from "../models/Student.js";
import Voter from "../models/Voter.js";
import { sendError } from "../utils/apiResponse.js";
import { resolveLogoUrl } from "../utils/logoUrl.js";
import {
  getPlanConfig,
  getSubscriptionTermConfig,
  syncSchoolSubscriptionState,
} from "../utils/plans.js";
import { registerMonitorPayloadBuilder } from "../utils/liveMonitorSocket.js";

const normalizeElectionStatus = (status) =>
  status === "ended" ? "closed" : status === "pending" ? "draft" : status;

const ensureSchoolAccess = (req, res, schoolId) => {
  if (req.schoolId?.toString() !== schoolId?.toString()) {
    sendError(res, 403, "You are not allowed to access this school");
    return false;
  }

  return true;
};

const mapActivity = (log) => ({
  _id: log._id.toString(),
  actorType: log.actorType,
  actorId: log.actorId?.toString?.() || null,
  action: log.action,
  metadata: log.metadata || {},
  createdAt: log.createdAt.toISOString(),
  updatedAt: log.updatedAt.toISOString(),
});

const getVoteParticipantKey = (vote) => {
  if (vote.studentId) {
    return `student:${vote.studentId.toString()}`;
  }

  if (vote.adminId) {
    return `admin:${vote.adminId.toString()}`;
  }

  return null;
};

const formatHourLabel = (date) => {
  const hours = date.getUTCHours();
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return `${hour12}${period}`;
};

const formatTimeRemaining = (endTime) => {
  if (!endTime) {
    return "0m";
  }

  const diffMs = new Date(endTime).getTime() - Date.now();
  if (diffMs <= 0) {
    return "0m";
  }

  const totalMinutes = Math.floor(diffMs / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
};

const buildTurnoutTrend = (election) => {
  const votes = [...(election.votes || [])].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  if (votes.length === 0) {
    return [];
  }

  const buckets = new Map();
  votes.forEach((vote) => {
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

const buildTurnoutGrowthPercentage = (turnoutTrend) => {
  if (turnoutTrend.length < 2) {
    return 0;
  }

  const previous = turnoutTrend[turnoutTrend.length - 2].votes;
  const current = turnoutTrend[turnoutTrend.length - 1].votes;

  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return Number((((current - previous) / previous) * 100).toFixed(1));
};

const buildVoteDistribution = (election) => {
  const totalVotes = election.votes?.length || 0;

  return (election.categories || []).map((category) => {
    const votes = (election.votes || []).filter(
      (vote) => vote.categoryId?.toString() === category._id.toString()
    ).length;

    return {
      label: category.title,
      value: votes,
      percentage:
        totalVotes > 0 ? Number(((votes / totalVotes) * 100).toFixed(1)) : 0,
    };
  });
};

const buildFacultyVoteStatus = ({
  registeredVoters,
  uniqueStudentVoterIds,
  studentById,
  registryFacultyByStudentId,
}) => {
  const registeredByFaculty = new Map();
  registeredVoters.forEach((voter) => {
    const faculty = voter.faculty || "Unknown";
    registeredByFaculty.set(faculty, (registeredByFaculty.get(faculty) || 0) + 1);
  });

  const votesByFaculty = new Map();
  uniqueStudentVoterIds.forEach((studentId) => {
    const student = studentById.get(studentId);
    const faculty =
      student?.department ||
      registryFacultyByStudentId.get(student?.studentId || "") ||
      "Unknown";
    votesByFaculty.set(faculty, (votesByFaculty.get(faculty) || 0) + 1);
  });

  return Array.from(registeredByFaculty.entries())
    .map(([name, registeredCount]) => {
      const votes = votesByFaculty.get(name) || 0;
      return {
        name,
        turnout:
          registeredCount > 0
            ? Number(((votes / registeredCount) * 100).toFixed(1))
            : 0,
        votes,
      };
    })
    .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
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
    const leadMargin =
      ballotsCount > 0
        ? Number((((leaderVotes - runnerUpVotes) / ballotsCount) * 100).toFixed(1))
        : 0;

    return {
      title: category.title,
      ballotsCount,
      leadMargin,
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

const buildElectionReport = ({ election, aspirants, studentsInSchool }) => {
  const studentById = new Map(
    studentsInSchool.map((student) => [student._id.toString(), student])
  );
  const electionVotes = election.votes || [];
  const totalEligibleVoters =
    election.eligibleVoters?.length > 0
      ? election.eligibleVoters.length
      : studentsInSchool.length;
  const uniqueVoterIds = new Set(
    electionVotes.map((vote) => getVoteParticipantKey(vote)).filter(Boolean)
  );
  const totalVotes = electionVotes.length;
  const turnoutPercentage =
    totalEligibleVoters > 0
      ? Number(((uniqueVoterIds.size / totalEligibleVoters) * 100).toFixed(2))
      : 0;

  let maleVotes = 0;
  let femaleVotes = 0;
  const departmentMap = new Map();

  electionVotes.forEach((vote) => {
    const student = studentById.get(vote.studentId?.toString());
    if (!student) return;

    if (student.gender === "male") maleVotes += 1;
    if (student.gender === "female") femaleVotes += 1;

    const department = student.department || "Unknown";
    departmentMap.set(department, (departmentMap.get(department) || 0) + 1);
  });

  const categories = (election.categories || []).map((category) => {
    const categoryId = category._id.toString();
    const categoryAspirants = aspirants.filter(
      (aspirant) => aspirant.categoryId?.toString() === categoryId
    );
    const categoryResults = categoryAspirants
      .map((aspirant) => ({
        _id: aspirant._id.toString(),
        name: aspirant.name,
        studentId: aspirant.studentId || "",
        programmeOfStudy: aspirant.programmeOfStudy || "",
        level: aspirant.level || "",
        faculty: aspirant.faculty || "",
        electoralCategory: aspirant.electoralCategory || category.title,
        position: aspirant.electoralCategory || category.title,
        department: aspirant.faculty || "",
        imageUrl: aspirant.imageUrl || "",
        voteCount: aspirant.voteCount || 0,
      }))
      .sort((a, b) => b.voteCount - a.voteCount || a.name.localeCompare(b.name));

    return {
      _id: categoryId,
      title: category.title,
      subTitle: category.subTitle || election.subTitle || "",
      totalVotes: electionVotes.filter(
        (vote) => vote.categoryId?.toString() === categoryId
      ).length,
      winner: categoryResults[0] || null,
      aspirants: categoryResults,
    };
  });

  return {
    _id: election._id.toString(),
    title: election.title,
    description: election.description || "",
    status: normalizeElectionStatus(election.status),
    startDate: election.startTime ? election.startTime.toISOString() : null,
    endDate: election.endTime ? election.endTime.toISOString() : null,
    totalEligibleVoters,
    totalVotes,
    uniqueVoters: uniqueVoterIds.size,
    turnoutPercentage,
    genderStats: {
      maleVotes,
      femaleVotes,
    },
    departmentStats: Array.from(departmentMap.entries())
      .map(([department, voteCount]) => ({ department, voteCount }))
      .sort((a, b) => b.voteCount - a.voteCount || a.department.localeCompare(b.department)),
    categories,
  };
};

export const getAdminDashboard = async (req, res) => {
  try {
    const { schoolId } = req.params;

    if (!ensureSchoolAccess(req, res, schoolId)) {
      return;
    }

    const [school, elections, studentsCount] = await Promise.all([
      School.findById(schoolId).populate("ecMembers", "name email"),
      Election.find({ schoolId }).sort({ startTime: -1, createdAt: -1 }),
      Student.countDocuments({ schoolId }),
    ]);

    if (!school) {
      return sendError(res, 404, "School not found");
    }
    syncSchoolSubscriptionState(school);

    const electionCounts = {
      draft: 0,
      scheduled: 0,
      active: 0,
      closed: 0,
    };

    elections.forEach((election) => {
      const status = normalizeElectionStatus(election.status);
      if (status in electionCounts) {
        electionCounts[status] += 1;
      }
    });

    const activeElectionsList = elections
      .filter((election) => {
        const status = normalizeElectionStatus(election.status);
        return status === "active" || status === "scheduled";
      })
      .map((election) => ({
        _id: election._id.toString(),
        title: election.title,
        status: normalizeElectionStatus(election.status),
        votesCast: election.votes?.length || 0,
        eligibleVoters:
          election.eligibleVoters?.length > 0
            ? election.eligibleVoters.length
            : studentsCount,
        startDate: election.startTime?.toISOString() || null,
        endDate: election.endTime?.toISOString() || null,
      }))
      .sort((a, b) => {
        const aTime = a.startDate ? new Date(a.startDate).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.startDate ? new Date(b.startDate).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      });

    const selectedPlan = getPlanConfig(school.plan);
    const selectedTerm = getSubscriptionTermConfig(school.subscriptionTerm);

    return res.status(200).json({
      _id: school._id.toString(),
      fullName: school.fullName || school.name,
      logoUrl: resolveLogoUrl(req, school.logoUrl),
      adminName: req.ecUser?.name || "",
      scheduledElections: electionCounts.scheduled,
      activeElections: electionCounts.active,
      closedElections: electionCounts.closed,
      subscription: {
        planName: selectedPlan.name,
        studentRange: selectedPlan.studentRange,
        voteLimit: selectedPlan.maxVoters,
        expiryDate: school.subscriptionExpiresAt?.toISOString() || null,
        isActive: school.subscriptionActive,
        subscriptionTerm: school.subscriptionTerm,
        subscriptionTermLabel: selectedTerm.label,
      },
      activeElectionsList,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load admin dashboard");
  }
};

export const getAdminReports = async (req, res) => {
  try {
    const { schoolId } = req.params;

    if (!ensureSchoolAccess(req, res, schoolId)) {
      return;
    }

    const [school, elections, studentsInSchool, adminsInSchool] = await Promise.all([
      School.findById(schoolId).select("name fullName shortName"),
      Election.find({ schoolId }).sort({ startTime: -1, createdAt: -1 }),
      Student.find({ schoolId }).select("_id"),
      ECUser.find({ schoolId }).select("_id"),
    ]);

    if (!school) {
      return sendError(res, 404, "School not found");
    }

    const totalEligibleVoters = studentsInSchool.length + adminsInSchool.length;
    const reports = elections.map((election) => {
      const uniqueVoters = new Set(
        (election.votes || [])
          .map((vote) => getVoteParticipantKey(vote))
          .filter(Boolean)
      ).size;

      return {
        _id: election._id.toString(),
        title: election.title,
        status: normalizeElectionStatus(election.status),
        startDate: election.startTime?.toISOString() || null,
        endDate: election.endTime?.toISOString() || null,
        totalVotes: election.votes?.length || 0,
        uniqueVoters,
        turnoutPercentage:
          totalEligibleVoters > 0
            ? Number(((uniqueVoters / totalEligibleVoters) * 100).toFixed(2))
            : 0,
        totalCategories: election.categories?.length || 0,
      };
    });

    return res.status(200).json({
      school: {
        _id: school._id.toString(),
        name: school.name,
        fullName: school.fullName || school.name,
        shortName: school.shortName || "",
      },
      totalEligibleVoters,
      reports,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load admin reports");
  }
};

export const getAdminElectionReport = async (req, res) => {
 try {
    const { electionId } = req.params;
    const election = await Election.findById(electionId);

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    if (!ensureSchoolAccess(req, res, election.schoolId)) {
      return;
    }

    const [aspirants, voters, students, admins] = await Promise.all([
      Aspirant.find({ electionId: election._id, schoolId: election.schoolId }).sort({
        electoralCategory: 1,
        voteCount: -1,
        name: 1,
      }),
      Voter.find({ electionId: election._id, schoolId: election.schoolId }).select(
        "studentId faculty"
      ),
      Student.find({ schoolId: election.schoolId }).select("_id studentId department"),
      ECUser.find({ schoolId: election.schoolId }).select("_id"),
    ]);

    const uniqueStudentVoterIds = Array.from(
      new Set(
        (election.votes || [])
          .map((vote) => vote.studentId?.toString())
          .filter(Boolean)
      )
    );
    const uniqueParticipantIds = new Set(
      (election.votes || [])
        .map((vote) => getVoteParticipantKey(vote))
        .filter(Boolean)
    );
    const studentById = new Map(students.map((student) => [student._id.toString(), student]));
    const registryFacultyByStudentId = new Map(
      voters.map((voter) => [voter.studentId, voter.faculty || "Unknown"])
    );

    const registeredVoters =
      (voters.length > 0 ? voters.length : election.eligibleVoters?.length || students.length) +
      admins.length;
    const accreditedVoters = uniqueParticipantIds.size;
    const votesCast = election.votes?.length || 0;
    const turnoutPercentage =
      registeredVoters > 0
        ? Number(((accreditedVoters / registeredVoters) * 100).toFixed(1))
        : 0;
    const turnoutTrend = buildTurnoutTrend(election);

    return res.status(200).json({
      _id: election._id.toString(),
      title: election.title,
      lastUpdatedAt: new Date().toISOString(),
      registeredVoters,
      votesCast,
      positionsCount: election.categories?.length || 0,
      turnoutPercentage,
      turnoutGrowthPercentage: buildTurnoutGrowthPercentage(turnoutTrend),
      accreditedVoters,
      timeRemaining: formatTimeRemaining(election.endTime),
      categoryLeaders: buildCategoryLeaders({ election, aspirants }),
      turnoutTrend,
      voteDistribution: buildVoteDistribution(election),
      facultyVoteStatus: buildFacultyVoteStatus({
        registeredVoters: voters,
        uniqueStudentVoterIds,
        studentById,
        registryFacultyByStudentId,
      }),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load election report");
  }
};

export const getAdminActivity = async (req, res) => {
  try {
    const { schoolId } = req.params;

    if (!ensureSchoolAccess(req, res, schoolId)) {
      return;
    }

    const school = await School.findById(schoolId).select("_id");
    if (!school) {
      return sendError(res, 404, "School not found");
    }

    const [logs, admins] = await Promise.all([
      ActivityLog.find({ schoolId, actorType: "admin" })
        .sort({ createdAt: -1 })
        .limit(50),
      ECUser.find({ schoolId }).select("name email"),
    ]);

    const adminById = new Map(admins.map((admin) => [admin._id.toString(), admin]));

    return res.status(200).json(
      logs.map((log) => {
        const mapped = mapActivity(log);
        const admin = log.actorType === "admin" ? adminById.get(mapped.actorId) : null;

        return {
          ...mapped,
          actorName: admin?.name || null,
          actorEmail: admin?.email || null,
        };
      })
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load admin activity");
  }
};

export const buildAdminElectionMonitorPayload = async ({ electionId, schoolId = null }) => {
  const election = await Election.findById(electionId);

  if (!election) {
    const error = new Error("Election not found");
    error.statusCode = 404;
    throw error;
  }

  if (schoolId && election.schoolId?.toString() !== schoolId?.toString()) {
    const error = new Error("You are not allowed to access this school");
    error.statusCode = 403;
    throw error;
  }

    const [aspirants, voters, students, admins] = await Promise.all([
  Aspirant.find({ electionId: election._id, schoolId: election.schoolId }).sort({
      electoralCategory: 1,
      voteCount: -1,
      name: 1,
    }),
    Voter.find({ electionId: election._id, schoolId: election.schoolId }).select(
      "studentId faculty"
    ),
    Student.find({ schoolId: election.schoolId }).select("_id studentId department"),
    ECUser.find({ schoolId: election.schoolId }).select("_id"),
  ]);

  const uniqueStudentVoterIds = Array.from(
    new Set(
      (election.votes || [])
        .map((vote) => vote.studentId?.toString())
        .filter(Boolean)
    )
  );
  const uniqueParticipantIds = new Set(
    (election.votes || [])
      .map((vote) => getVoteParticipantKey(vote))
      .filter(Boolean)
  );
  const studentById = new Map(students.map((student) => [student._id.toString(), student]));
  const registryFacultyByStudentId = new Map(
    voters.map((voter) => [voter.studentId, voter.faculty || "Unknown"])
  );

  const registeredVoters =
    (voters.length > 0 ? voters.length : election.eligibleVoters?.length || students.length) +
    admins.length;
  const accreditedVoters = uniqueParticipantIds.size;
  const votesCast = election.votes?.length || 0;
  const turnoutPercentage =
    registeredVoters > 0
      ? Number(((accreditedVoters / registeredVoters) * 100).toFixed(1))
      : 0;
  const turnoutTrend = buildTurnoutTrend(election);

  return {
    _id: election._id.toString(),
    title: election.title,
    updatedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    registeredVoters,
    votesCast,
    positionsCount: election.categories?.length || 0,
    turnoutPercentage,
    turnoutGrowthPercentage: buildTurnoutGrowthPercentage(turnoutTrend),
    accreditedVoters,
    timeRemaining: formatTimeRemaining(election.endTime),
    categoryLeaders: buildCategoryLeaders({ election, aspirants }),
    turnoutTrend,
    voteDistribution: buildVoteDistribution(election),
    facultyVoteStatus: buildFacultyVoteStatus({
      registeredVoters: voters,
      uniqueStudentVoterIds,
      studentById,
      registryFacultyByStudentId,
    }),
  };
};

registerMonitorPayloadBuilder(buildAdminElectionMonitorPayload);

export const getAdminElectionMonitor = async (req, res) => {
  try {
    const payload = await buildAdminElectionMonitorPayload({
      electionId: req.params.electionId,
      schoolId: req.schoolId,
    });
    return res.status(200).json(payload);
  } catch (error) {
    return sendError(res, error.statusCode || 500, error.message || "Failed to load election monitor");
  }
};
