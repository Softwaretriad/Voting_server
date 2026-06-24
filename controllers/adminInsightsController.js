import ActivityLog from "../models/ActivityLog.js";
import Aspirant from "../models/Aspirant.js";
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
import { EC_ROLE, ecRoleQuery, normalizeActorType } from "../utils/ecRole.js";
import { getStoredVotesForElection } from "../utils/voteStore.js";
import { buildPaginationMeta, getPagination } from "../utils/pagination.js";
import { getCacheJson, setCacheJson } from "../utils/redisClient.js";
import {
  getElectionAnalyticsSnapshot,
  refreshElectionAnalyticsSnapshot,
} from "../utils/electionAnalytics.js";

const normalizeElectionStatus = (status) =>
  status === "ended" ? "closed" : status === "pending" ? "draft" : status;

const attachStoredVotes = async (election) => {
  const votes = await getStoredVotesForElection(election);
  const electionObject = election.toObject?.() || election;
  return {
    ...electionObject,
    _id: election._id,
    votes,
    totalVotes: votes.length || election.totalVotes || 0,
  };
};

const ensureSchoolAccess = (req, res, schoolId) => {
  if (req.schoolId?.toString() !== schoolId?.toString()) {
    sendError(res, 403, "You are not allowed to access this school");
    return false;
  }

  return true;
};

const mapActivity = (log) => ({
  _id: log._id.toString(),
  actorType: normalizeActorType(log.actorType),
  actorId: log.actorId?.toString?.() || null,
  actorName: log.actorName || "",
  actorFirstName: log.actorFirstName || "",
  actorLastName: log.actorLastName || "",
  actorEmail: log.actorEmail || "",
  actorStudentId: log.actorStudentId || "",
  action: log.action,
  metadata: log.metadata || {},
  createdAt: log.createdAt.toISOString(),
  updatedAt: log.updatedAt.toISOString(),
});

const stripActorMetadata = (metadata = {}) => {
  const {
    ecName,
    ecFirstName,
    ecLastName,
    ecEmail,
    ecStudentId,
    actorName,
    actorFirstName,
    actorLastName,
    actorEmail,
    actorStudentId,
    ...activityMetadata
  } = metadata || {};

  return activityMetadata;
};

const getVoteStudentIdentity = (vote) =>
  vote.studentId || vote.ecUserId || vote.voterId || null;

const getAccreditedVoterKey = (vote) => {
  const identity = getVoteStudentIdentity(vote);
  return identity ? identity.toString() : null;
};

const getAccreditedVoterCount = (votes = []) =>
  new Set(votes.map((vote) => getAccreditedVoterKey(vote)).filter(Boolean)).size;

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

export const getAdminDashboard = async (req, res) => {
  try {
    const { schoolId } = req.params;

    if (!ensureSchoolAccess(req, res, schoolId)) {
      return;
    }

    const [school, elections, studentsCount] = await Promise.all([
      School.findById(schoolId),
      Election.find({ schoolId }).sort({ startTime: -1, createdAt: -1 }),
      Student.countDocuments({ schoolId }),
    ]);

    if (!school) {
      return sendError(res, 404, "School not found");
    }
    syncSchoolSubscriptionState(school);
    const electionsWithVotes = await Promise.all(elections.map(attachStoredVotes));

    const electionCounts = {
      draft: 0,
      scheduled: 0,
      active: 0,
      closed: 0,
    };

    electionsWithVotes.forEach((election) => {
      const status = normalizeElectionStatus(election.status);
      if (status in electionCounts) {
        electionCounts[status] += 1;
      }
    });

    const activeElectionsList = electionsWithVotes
      .filter((election) => {
        const status = normalizeElectionStatus(election.status);
        return status === "active" || status === "scheduled";
      })
      .map((election) => {
        const accreditedVoters = getAccreditedVoterCount(election.votes);
        const ballotsCast = election.votes?.length || 0;

        return {
          _id: election._id.toString(),
          title: election.title,
          status: normalizeElectionStatus(election.status),
          imageUrl: election.imageUrl || "",
          votesCast: accreditedVoters,
          totalVotes: ballotsCast,
          accreditedVoters,
          ballotsCast,
          totalBallotsCast: ballotsCast,
          eligibleVoters:
            election.eligibleVoters?.length > 0
              ? election.eligibleVoters.length
              : studentsCount,
          startDate: election.startTime?.toISOString() || null,
          endDate: election.endTime?.toISOString() || null,
        };
      })
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
      firstName: req.ecUser?.firstName || "",
      lastName: req.ecUser?.lastName || "",
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
    return sendError(res, 500, error.message || "Failed to load EC dashboard");
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
      Student.find({ schoolId, accountRole: "student" }).select("_id"),
      Student.find({ schoolId, accountRole: ecRoleQuery() }).select("_id"),
    ]);

    if (!school) {
      return sendError(res, 404, "School not found");
    }

    const pagination = getPagination(req.query);
    const totalEligibleVoters = studentsInSchool.length + adminsInSchool.length;
    const electionsWithVotes = await Promise.all(elections.map(attachStoredVotes));
    const pagedElections = pagination.enabled
      ? electionsWithVotes.slice(pagination.skip, pagination.skip + pagination.limit)
      : electionsWithVotes;
    const reports = pagedElections.map((election) => {
      const uniqueVoters = getAccreditedVoterCount(election.votes);
      const ballotsCast = election.votes?.length || 0;

      return {
        _id: election._id.toString(),
        title: election.title,
        status: normalizeElectionStatus(election.status),
        startDate: election.startTime?.toISOString() || null,
        endDate: election.endTime?.toISOString() || null,
        totalVotes: ballotsCast,
        votesCast: uniqueVoters,
        uniqueVoters,
        accreditedVoters: uniqueVoters,
        ballotsCast,
        totalBallotsCast: ballotsCast,
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
      ...(pagination.enabled
        ? {
            pagination: buildPaginationMeta({
              ...pagination,
              total: electionsWithVotes.length,
            }),
          }
        : {}),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load EC reports");
  }
};

export const getAdminElectionReport = async (req, res) => {
 try {
    const { electionId } = req.params;
    const storedElection = await Election.findById(electionId);

    if (!storedElection) {
      return sendError(res, 404, "Election not found");
    }

    if (!ensureSchoolAccess(req, res, storedElection.schoolId)) {
      return;
    }

    const snapshot =
      (await getElectionAnalyticsSnapshot(storedElection._id)) ||
      (await refreshElectionAnalyticsSnapshot(storedElection));
    const election = await attachStoredVotes(storedElection);

    const [aspirants, voters, students, admins] = await Promise.all([
      Aspirant.find({ electionId: election._id, schoolId: election.schoolId }).sort({
        electoralCategory: 1,
        voteCount: -1,
        name: 1,
      }),
      Voter.find({ electionId: election._id, schoolId: election.schoolId }).select(
        "studentId faculty"
      ),
      Student.find({ schoolId: election.schoolId }).select("_id studentId department accountRole"),
      Student.find({ schoolId: election.schoolId, accountRole: ecRoleQuery() }).select("_id"),
    ]);

    const uniqueStudentVoterIds = Array.from(
      new Set(
        (election.votes || [])
          .map((vote) => getVoteStudentIdentity(vote)?.toString())
          .filter(Boolean)
      )
    );
    const uniqueAccreditedVoterIds = new Set(
      (election.votes || [])
        .map((vote) => getAccreditedVoterKey(vote))
        .filter(Boolean)
    );
    const studentById = new Map(students.map((student) => [student._id.toString(), student]));
    const registryFacultyByStudentId = new Map(
      voters.map((voter) => [voter.studentId, voter.faculty || "Unknown"])
    );

    const registeredVoters =
      snapshot?.registeredVoters ||
      (voters.length > 0 ? voters.length : election.eligibleVoters?.length || students.length + admins.length);
    const accreditedVoters = uniqueAccreditedVoterIds.size;
    const ballotsCast = election.votes?.length || 0;
    const votesCast = accreditedVoters;
    const turnoutPercentage =
      registeredVoters > 0
      ? Number(((accreditedVoters / registeredVoters) * 100).toFixed(1))
      : 0;
    const turnoutTrend = snapshot?.turnoutTrend?.length
      ? snapshot.turnoutTrend
      : buildTurnoutTrend(election);

    return res.status(200).json({
      _id: election._id.toString(),
      title: election.title,
      lastUpdatedAt: new Date().toISOString(),
      registeredVoters,
      votesCast,
      totalVotes: ballotsCast,
      ballotsCast,
      totalBallotsCast: ballotsCast,
      positionsCount: election.categories?.length || 0,
      turnoutPercentage,
      turnoutGrowthPercentage: buildTurnoutGrowthPercentage(turnoutTrend),
      accreditedVoters,
      timeRemaining: formatTimeRemaining(election.endTime),
      categoryLeaders: snapshot?.categoryLeaders?.length
        ? snapshot.categoryLeaders
        : buildCategoryLeaders({ election, aspirants }),
      turnoutTrend,
      voteDistribution: snapshot?.voteDistribution?.length
        ? snapshot.voteDistribution
        : buildVoteDistribution(election),
      facultyVoteStatus: snapshot?.facultyVoteStatus?.length
        ? snapshot.facultyVoteStatus
        : buildFacultyVoteStatus({
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

    const pagination = getPagination(req.query, { defaultLimit: 250, maxLimit: 250 });
    const filter = { schoolId, actorType: EC_ROLE };
    const logQuery = ActivityLog.find(filter).sort({ createdAt: -1 });
    if (pagination.enabled) {
      logQuery.skip(pagination.skip).limit(pagination.limit);
    } else {
      logQuery.limit(250);
    }

    const [logs, total] = await Promise.all([
      logQuery,
      pagination.enabled ? ActivityLog.countDocuments(filter) : Promise.resolve(null),
    ]);

    const actorIds = Array.from(
      new Set(logs.map((log) => log.actorId?.toString()).filter(Boolean))
    );
    const actors = actorIds.length
      ? await Student.find({ _id: { $in: actorIds } }).select(
          "firstName lastName email studentId accountRole"
        )
      : [];
    const actorById = new Map(actors.map((actor) => [actor._id.toString(), actor]));

    const items = logs.map((log) => {
      const mapped = mapActivity(log);
      const actor = mapped.actorId ? actorById.get(mapped.actorId) : null;
      const ecFirstName = mapped.actorFirstName || actor?.firstName || "";
      const ecLastName = mapped.actorLastName || actor?.lastName || "";
      const ecName =
        mapped.actorName ||
        `${ecFirstName} ${ecLastName}`.trim() ||
        mapped.metadata?.ecName ||
        mapped.metadata?.actorName ||
        actor?.email ||
        null;
      const ecEmail = mapped.actorEmail || actor?.email || mapped.metadata?.email || null;
      const ecStudentId =
        mapped.actorStudentId || actor?.studentId || mapped.metadata?.studentId || null;

      return {
        _id: mapped._id,
        actorType: mapped.actorType,
        actorId: mapped.actorId,
        action: mapped.action,
        metadata: stripActorMetadata(mapped.metadata),
        createdAt: mapped.createdAt,
        updatedAt: mapped.updatedAt,
        actor: {
          id: mapped.actorId,
          type: mapped.actorType,
          name: ecName,
          firstName: ecFirstName || null,
          lastName: ecLastName || null,
          email: ecEmail,
          studentId: ecStudentId,
          accountRole: actor?.accountRole || normalizeActorType(log.actorType),
        },
        actorName: ecName,
        actorAccountRole: actor?.accountRole || normalizeActorType(log.actorType),
      };
    });

    if (pagination.enabled) {
      return res.status(200).json({
        items,
        pagination: buildPaginationMeta({ ...pagination, total }),
      });
    }

    return res.status(200).json(items);
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load EC activity");
  }
};

export const buildAdminElectionMonitorPayload = async ({
  electionId,
  schoolId = null,
  forceRefresh = false,
} = {}) => {
  const cacheKey = `monitor:election:${electionId}:${schoolId || "any"}`;
  if (!forceRefresh) {
    const cachedPayload = await getCacheJson(cacheKey);
    if (cachedPayload) {
      return cachedPayload;
    }
  }

  const storedElection = await Election.findById(electionId);

  if (!storedElection) {
    const error = new Error("Election not found");
    error.statusCode = 404;
    throw error;
  }

  if (schoolId && storedElection.schoolId?.toString() !== schoolId?.toString()) {
    const error = new Error("You are not allowed to access this school");
    error.statusCode = 403;
    throw error;
  }

  const snapshot =
    (await getElectionAnalyticsSnapshot(storedElection._id)) ||
    (await refreshElectionAnalyticsSnapshot(storedElection));
  const election = await attachStoredVotes(storedElection);

  const [aspirants, voters, students, admins] = await Promise.all([
    Aspirant.find({ electionId: election._id, schoolId: election.schoolId }).sort({
      electoralCategory: 1,
      voteCount: -1,
      name: 1,
    }),
    Voter.find({ electionId: election._id, schoolId: election.schoolId }).select(
      "studentId faculty"
    ),
    Student.find({ schoolId: election.schoolId }).select("_id studentId department accountRole"),
    Student.find({ schoolId: election.schoolId, accountRole: ecRoleQuery() }).select("_id"),
  ]);

  const uniqueStudentVoterIds = Array.from(
    new Set(
      (election.votes || [])
        .map((vote) => getVoteStudentIdentity(vote)?.toString())
        .filter(Boolean)
    )
  );
  const uniqueAccreditedVoterIds = new Set(
    (election.votes || [])
      .map((vote) => getAccreditedVoterKey(vote))
      .filter(Boolean)
  );
  const studentById = new Map(students.map((student) => [student._id.toString(), student]));
  const registryFacultyByStudentId = new Map(
    voters.map((voter) => [voter.studentId, voter.faculty || "Unknown"])
  );

  const registeredVoters =
    snapshot?.registeredVoters ||
    (voters.length > 0 ? voters.length : election.eligibleVoters?.length || students.length + admins.length);
  const accreditedVoters = uniqueAccreditedVoterIds.size;
  const ballotsCast = election.votes?.length || 0;
  const votesCast = accreditedVoters;
  const turnoutPercentage =
    (registeredVoters > 0
      ? Number(((accreditedVoters / registeredVoters) * 100).toFixed(1))
      : 0);
  const turnoutTrend = snapshot?.turnoutTrend?.length
    ? snapshot.turnoutTrend
    : buildTurnoutTrend(election);

  const payload = {
    _id: election._id.toString(),
    title: election.title,
    updatedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    registeredVoters,
    votesCast,
    totalVotes: ballotsCast,
    ballotsCast,
    totalBallotsCast: ballotsCast,
    positionsCount: election.categories?.length || 0,
    turnoutPercentage,
    turnoutGrowthPercentage: buildTurnoutGrowthPercentage(turnoutTrend),
    accreditedVoters,
    timeRemaining: formatTimeRemaining(election.endTime),
    categoryLeaders: snapshot?.categoryLeaders?.length
      ? snapshot.categoryLeaders
      : buildCategoryLeaders({ election, aspirants }),
    turnoutTrend,
    voteDistribution: snapshot?.voteDistribution?.length
      ? snapshot.voteDistribution
      : buildVoteDistribution(election),
    facultyVoteStatus: snapshot?.facultyVoteStatus?.length
      ? snapshot.facultyVoteStatus
      : buildFacultyVoteStatus({
          registeredVoters: voters,
          uniqueStudentVoterIds,
          studentById,
          registryFacultyByStudentId,
        }),
  };

  await setCacheJson(cacheKey, payload, Number(process.env.MONITOR_CACHE_TTL_SECONDS || 3));
  return payload;
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
