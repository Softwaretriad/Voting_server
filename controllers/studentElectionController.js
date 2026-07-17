import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";
import {
  filterEligibleElectionsForStudent,
  isStudentEligibleForElection,
} from "../utils/electionEligibility.js";
import { processElectionLifecycle } from "../utils/electionResultsProcessor.js";
import { registerStudentElectionPayloadBuilder } from "../utils/liveMonitorSocket.js";
import { getCacheJson, setCacheJson } from "../utils/redisClient.js";
import { getStoredVotesForElection } from "../utils/voteStore.js";

const getStudentSchoolId = (student) => student.schoolId?.toString() || null;
const STUDENT_ELECTION_LIST_CACHE_TTL_SECONDS = Number(
  process.env.STUDENT_ELECTION_LIST_CACHE_TTL_SECONDS || 3
);
const STUDENT_ELECTION_LOCAL_CACHE_TTL_MS = Number(
  process.env.STUDENT_ELECTION_LOCAL_CACHE_TTL_MS ||
    Math.min(STUDENT_ELECTION_LIST_CACHE_TTL_SECONDS * 1000, 5000)
);
const studentElectionListLocalCache = new Map();
const electionListProjection = () =>
  [
    "title",
    "description",
    "status",
    "startTime",
    "endTime",
    "schoolId",
    "subTitle",
    "imageUrl",
    "totalVotes",
    "categories",
    "audience",
    "createdAt",
  ]
    .filter(Boolean)
    .join(" ");
const shouldRunLifecycleOnStudentRead = () => process.env.ELECTION_LIFECYCLE_ON_READ === "true";

const maybeProcessScheduledElectionsOnRead = async () => {
  if (shouldRunLifecycleOnStudentRead()) {
    await processElectionLifecycle();
  }
};

const getStudentElectionListCacheKey = ({ student, scope }) => {
  const studentId = student?._id?.toString?.() || "anonymous";
  const schoolId = getStudentSchoolId(student) || "none";
  return `student-election-list:${scope}:${schoolId}:${studentId}`;
};

const getLocalStudentElectionList = (cacheKey) => {
  const cached = studentElectionListLocalCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    studentElectionListLocalCache.delete(cacheKey);
    return null;
  }

  return cached.promise;
};

const setLocalStudentElectionList = (cacheKey, promise) => {
  if (STUDENT_ELECTION_LOCAL_CACHE_TTL_MS <= 0) {
    return;
  }

  if (studentElectionListLocalCache.size > 5000) {
    const oldestKey = studentElectionListLocalCache.keys().next().value;
    if (oldestKey) {
      studentElectionListLocalCache.delete(oldestKey);
    }
  }

  studentElectionListLocalCache.set(cacheKey, {
    promise,
    expiresAt: Date.now() + STUDENT_ELECTION_LOCAL_CACHE_TTL_MS,
  });
};

const getCachedStudentElectionList = async ({ cacheKey, build }) => {
  const localPromise = getLocalStudentElectionList(cacheKey);
  if (localPromise) {
    return localPromise;
  }

  const promise = (async () => {
    const cached = await getCacheJson(cacheKey);
    if (cached) {
      return cached;
    }

    const payload = await build();
    await setCacheJson(cacheKey, payload, STUDENT_ELECTION_LIST_CACHE_TTL_SECONDS);
    return payload;
  })().catch((error) => {
    studentElectionListLocalCache.delete(cacheKey);
    throw error;
  });

  setLocalStudentElectionList(cacheKey, promise);
  return promise;
};

const toElectionCard = (election, voteCount = null) => {
  const status = election.status === "ended" ? "closed" : election.status;

  return {
    _id: election._id.toString(),
    title: election.title,
    description: election.description || "",
    status,
    startDate: election.startTime ? election.startTime.toISOString() : null,
    endDate: election.endTime ? election.endTime.toISOString() : null,
    schoolId: election.schoolId?.toString?.() || election.schoolId,
    subTitle: election.subTitle || "",
    imageUrl: election.imageUrl || "",
    voteCount: voteCount ?? election.totalVotes ?? 0,
    listScope: status === "scheduled" ? "schedule" : status === "active" ? "active" : "results",
    isScheduled: status === "scheduled",
    isActive: status === "active",
  };
};

const hasStudentVoteInVotes = ({ votes = [], studentId, categoryId }) =>
  votes.some(
    (vote) =>
      (vote.studentId || vote.voterId)?.toString() === String(studentId) &&
      vote.categoryId?.toString() === String(categoryId)
  );

const mapStudentCategory = ({ election, category, studentId, votes = [] }) => ({
  _id: category._id.toString(),
  electionId: election._id.toString(),
  title: category.title,
  subTitle: category.subTitle || election.subTitle || "",
  imageUrl: category.imageUrl || "",
  totalVotes: votes.filter(
    (vote) => vote.categoryId?.toString() === category._id.toString()
  ).length,
  hasVotedInCategory: hasStudentVoteInVotes({
    votes,
    studentId,
    categoryId: category._id,
  }),
});

const mapStudentAspirant = ({ aspirant, election, studentId, electionId, votes = [] }) => ({
  _id: aspirant._id.toString(),
  electionId: aspirant.electionId?.toString() || electionId,
  categoryId: aspirant.categoryId?.toString() || aspirant.electoralCategory,
  name: aspirant.name,
  studentId: aspirant.studentId || "",
  programmeOfStudy: aspirant.programmeOfStudy || "",
  level: aspirant.level || "",
  faculty: aspirant.faculty || "",
  electoralCategory: aspirant.electoralCategory || "",
  department: aspirant.faculty || "",
  imageUrl: aspirant.imageUrl || "",
  voteCount: aspirant.voteCount || 0,
  hasVotedInCategory: hasStudentVoteInVotes({
    votes,
    studentId,
    categoryId: aspirant.categoryId?.toString() || aspirant.electoralCategory,
  }),
});

const buildStudentCategoryPayloads = ({ election, aspirants, studentId, votes = [] }) => {
  if (election.categories.length > 0) {
    return election.categories.map((category) => ({
      ...mapStudentCategory({
        election,
        category,
        studentId,
        votes,
      }),
      aspirants: aspirants
        .filter((aspirant) => aspirant.categoryId?.toString() === category._id.toString())
        .map((aspirant) =>
          mapStudentAspirant({
            aspirant,
            election,
            studentId,
            electionId: election._id.toString(),
            votes,
          })
        ),
    }));
  }

  return Array.from(
    new Map(
      aspirants.map((aspirant) => [
        aspirant.categoryId?.toString() || aspirant.electoralCategory,
        {
          ...mapStudentCategory({
            election,
            category: {
              _id: aspirant.categoryId?.toString() || aspirant.electoralCategory,
              title: aspirant.electoralCategory,
              subTitle: election.subTitle || "",
              imageUrl: aspirant.imageUrl || "",
            },
            studentId,
            votes,
          }),
          aspirants: aspirants
            .filter(
              (item) =>
                (item.categoryId?.toString() || item.electoralCategory) ===
                (aspirant.categoryId?.toString() || aspirant.electoralCategory)
            )
            .map((item) =>
              mapStudentAspirant({
                aspirant: item,
                election,
                studentId,
                electionId: election._id.toString(),
                votes,
              })
            ),
        },
      ])
    ).values()
  );
};

export const getElectionById = async (req, res) => {
  try {
    await maybeProcessScheduledElectionsOnRead();
    const { electionId } = req.params;
    const schoolId = getStudentSchoolId(req.student);
    const election = await Election.findById(electionId).lean();

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    if (schoolId && election.schoolId?.toString() !== schoolId) {
      return sendError(res, 403, "You are not allowed to access this election");
    }

    const isEligible = await isStudentEligibleForElection({
      election,
      student: req.student,
    });
    if (!isEligible) {
      return sendError(res, 403, "You are not eligible for this election");
    }

    const voteCount = election.totalVotes || 0;

    return res.status(200).json({
      ...toElectionCard(election, voteCount),
      categories: (election.categories || []).map((category) => category.title),
      votesCast: voteCount,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load election");
  }
};

export const getActiveElections = async (req, res) => {
  try {
    await maybeProcessScheduledElectionsOnRead();
    const cacheKey = getStudentElectionListCacheKey({
      student: req.student,
      scope: "active",
    });
    const cards = await getCachedStudentElectionList({
      cacheKey,
      build: async () => {
        const schoolId = getStudentSchoolId(req.student);
        const elections = await Election.find({
          status: "active",
          ...(schoolId ? { schoolId } : {}),
        })
          .select(electionListProjection())
          .sort({ startTime: 1, createdAt: -1 })
          .lean();
        const eligibleElections = await filterEligibleElectionsForStudent({
          elections,
          student: req.student,
        });

        return eligibleElections.map((election) => toElectionCard(election));
      },
    });

    return res.status(200).json(cards);
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load active elections");
  }
};

export const getElectionSchedule = async (req, res) => {
  try {
    await maybeProcessScheduledElectionsOnRead();
    const cacheKey = getStudentElectionListCacheKey({
      student: req.student,
      scope: "schedule",
    });
    const schedule = await getCachedStudentElectionList({
      cacheKey,
      build: async () => {
        const schoolId = getStudentSchoolId(req.student);
        const elections = await Election.find({
          status: "scheduled",
          ...(schoolId ? { schoolId } : {}),
        })
          .select(
            [
              "title",
              "startTime",
              "endTime",
              "schoolId",
              "imageUrl",
              "audience",
              "categories",
            ]
              .filter(Boolean)
              .join(" ")
          )
          .sort({ startTime: 1 })
          .lean();
        const eligibleElections = await filterEligibleElectionsForStudent({
          elections,
          student: req.student,
        });

        return eligibleElections.map((election) => ({
          _id: election._id.toString(),
          electionTitle: election.title,
          status: "scheduled",
          listScope: "schedule",
          isScheduled: true,
          isActive: false,
          imageUrl: election.imageUrl || "",
          scheduledDate: election.startTime
            ? election.startTime.toISOString()
            : election.endTime.toISOString(),
          scheduledTime: new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "UTC",
          }).format(election.startTime || election.endTime),
        }));
      },
    });

    return res.status(200).json(schedule);
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load election schedule");
  }
};

export const getElectionStatistics = async (req, res) => {
  try {
    const year = Number(req.query.year);
    const schoolId = getStudentSchoolId(req.student);

    if (!year) {
      return sendError(res, 400, "year query parameter is required");
    }

    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const students = await Student.find({});
    const studentById = new Map(students.map((student) => [student._id.toString(), student]));
    const elections = await Election.find({
      ...(schoolId ? { schoolId } : {}),
      $or: [
        { startTime: { $gte: start, $lt: end } },
        { endTime: { $gte: start, $lt: end } },
      ],
    });

    const departmentCounts = new Map();
    let maleVotes = 0;
    let femaleVotes = 0;
    let totalVotes = 0;

    const electionVotes = await Promise.all(
      elections.map(async (election) => getStoredVotesForElection(election))
    );

    electionVotes.forEach((votes) => {
      votes.forEach((vote) => {
        const student = studentById.get(vote.studentId?.toString());
        if (!student) return;

        totalVotes += 1;
        if (student.gender === "male") maleVotes += 1;
        if (student.gender === "female") femaleVotes += 1;

        const department = student.department || "Unknown";
        departmentCounts.set(department, (departmentCounts.get(department) || 0) + 1);
      });
    });

    return res.status(200).json({
      year,
      totalVotes,
      maleVotes,
      femaleVotes,
      departmentStats: Array.from(departmentCounts.entries()).map(([department, voteCount]) => ({
        department,
        voteCount,
      })),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load election statistics");
  }
};

export const getElectionResults = async (req, res) => {
  try {
    const cacheKey = getStudentElectionListCacheKey({
      student: req.student,
      scope: "results",
    });
    const cards = await getCachedStudentElectionList({
      cacheKey,
      build: async () => {
        const schoolId = getStudentSchoolId(req.student);
        const elections = await Election.find({
          status: { $in: ["active", "ended", "closed"] },
          ...(schoolId ? { schoolId } : {}),
        })
          .select(electionListProjection())
          .sort({ startTime: -1 })
          .lean();
        const eligibleElections = await filterEligibleElectionsForStudent({
          elections,
          student: req.student,
        });

        return eligibleElections.map((election) => toElectionCard(election));
      },
    });

    return res.status(200).json(cards);
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load election results");
  }
};

export const getElectionCategories = async (req, res) => {
  try {
    const { electionId } = req.params;
    const election = await Election.findById(electionId);

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    const schoolId = getStudentSchoolId(req.student);
    if (schoolId && election.schoolId?.toString() !== schoolId) {
      return sendError(res, 403, "You are not allowed to access this election");
    }
    const isEligible = await isStudentEligibleForElection({
      election,
      student: req.student,
    });
    if (!isEligible) {
      return sendError(res, 403, "You are not eligible for this election");
    }

    const votes = await getStoredVotesForElection(election);
    let categories = election.categories.map((category) => ({
      ...mapStudentCategory({
        election,
        category,
        studentId: req.student?._id,
        votes,
      }),
    }));

    if (categories.length === 0) {
      const aspirants = await Aspirant.find({ electionId: election._id });
      categories = Array.from(
        new Map(
          aspirants.map((aspirant) => [
            aspirant.categoryId?.toString() || aspirant.electoralCategory,
            {
              ...mapStudentCategory({
                election,
                category: {
                  _id: aspirant.categoryId?.toString() || aspirant.electoralCategory,
                  title: aspirant.electoralCategory,
                  subTitle: election.subTitle || "",
                  imageUrl: aspirant.imageUrl || "",
                },
                studentId: req.student?._id,
                votes,
              }),
            },
          ])
        ).values()
      );
    }

    return res.status(200).json(categories);
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load election categories");
  }
};

export const getAspirantsForElection = async (req, res) => {
  try {
    const { electionId } = req.params;
    const schoolId = getStudentSchoolId(req.student);
    const election = await Election.findById(electionId).select("schoolId audience");

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    if (schoolId && election.schoolId?.toString() !== schoolId) {
      return sendError(res, 403, "You are not allowed to access this election");
    }
    const isEligible = await isStudentEligibleForElection({
      election,
      student: req.student,
    });
    if (!isEligible) {
      return sendError(res, 403, "You are not eligible for this election");
    }

    const aspirants = await Aspirant.find({
      electionId,
      ...(schoolId ? { schoolId } : {}),
    }).sort({ name: 1 });
    const votes = await getStoredVotesForElection(election);

    return res.status(200).json(
      aspirants.map((aspirant) =>
        mapStudentAspirant({
          aspirant,
          election,
          studentId: req.student?._id,
          electionId,
          votes,
        })
      )
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load aspirants");
  }
};

export const buildStudentElectionRealtimePayload = async ({ electionId, studentId }) => {
  const election = await Election.findById(electionId);

  if (!election) {
    const error = new Error("Election not found");
    error.statusCode = 404;
    throw error;
  }

  const student = await Student.findById(studentId).select(
    "_id studentId schoolId department nationality accountRole"
  );
  if (!student) {
    const error = new Error("Student not found");
    error.statusCode = 401;
    throw error;
  }

  const schoolId = getStudentSchoolId(student);
  if (schoolId && election.schoolId?.toString() !== schoolId) {
    const error = new Error("You are not allowed to access this election");
    error.statusCode = 403;
    throw error;
  }
  const isEligible = await isStudentEligibleForElection({
    election,
    student,
  });
  if (!isEligible) {
    const error = new Error("You are not eligible for this election");
    error.statusCode = 403;
    throw error;
  }

  const aspirants = await Aspirant.find({
    electionId,
    ...(schoolId ? { schoolId } : {}),
  }).sort({ electoralCategory: 1, name: 1 });
  const votes = await getStoredVotesForElection(election);
  const voteCount = votes.length || election.totalVotes || 0;

  const categories = buildStudentCategoryPayloads({
    election,
    aspirants,
    studentId: student._id,
    votes,
  });
  const mappedAspirants = aspirants.map((aspirant) =>
    mapStudentAspirant({
      aspirant,
      election,
      studentId: student._id,
      electionId,
      votes,
    })
  );

  return {
    ...toElectionCard(election, voteCount),
    updatedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    votesCast: voteCount,
    categories,
    categoryResults: categories,
    aspirants: mappedAspirants,
    aspirantResults: mappedAspirants,
    data: {
      categories,
      categoryResults: categories,
      aspirants: mappedAspirants,
      aspirantResults: mappedAspirants,
    },
  };
};

registerStudentElectionPayloadBuilder(buildStudentElectionRealtimePayload);

export const getCategoryResults = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const schoolId = getStudentSchoolId(req.student);
    const rawAspirants = await Aspirant.find({
      ...(schoolId ? { schoolId } : {}),
      $or: [{ categoryId }, { electoralCategory: categoryId }],
    }).sort({ voteCount: -1, name: 1 });
    const electionIds = Array.from(
      new Set(rawAspirants.map((aspirant) => aspirant.electionId?.toString()).filter(Boolean))
    );
    const elections = await Election.find({
      _id: { $in: electionIds },
      ...(schoolId ? { schoolId } : {}),
    });
    const eligibleElections = await filterEligibleElectionsForStudent({
      elections,
      student: req.student,
    });
    const eligibleElectionIdSet = new Set(
      eligibleElections.map((election) => election._id.toString())
    );
    const aspirants = rawAspirants.filter((aspirant) =>
      eligibleElectionIdSet.has(aspirant.electionId?.toString())
    );

    return res.status(200).json(
      aspirants.map((aspirant) => ({
        _id: aspirant._id.toString(),
        categoryId: aspirant.categoryId?.toString() || aspirant.electoralCategory,
        name: aspirant.name,
        studentId: aspirant.studentId || "",
        programmeOfStudy: aspirant.programmeOfStudy || "",
        level: aspirant.level || "",
        faculty: aspirant.faculty || "",
        electoralCategory: aspirant.electoralCategory || "",
        department: aspirant.faculty || "",
        voteCount: aspirant.voteCount || 0,
        imageUrl: aspirant.imageUrl || "",
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load category results");
  }
};
