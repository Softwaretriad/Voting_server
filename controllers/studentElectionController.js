import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";
import {
  filterEligibleElectionsForStudent,
  isStudentEligibleForElection,
} from "../utils/electionEligibility.js";
import { registerStudentElectionPayloadBuilder } from "../utils/liveMonitorSocket.js";
import { hasStudentVotedInCategory } from "../utils/voteState.js";

const getStudentSchoolId = (student) => student.schoolId?.toString() || null;

const toElectionCard = (election) => ({
  _id: election._id.toString(),
  title: election.title,
  description: election.description || "",
  status: election.status === "ended" ? "closed" : election.status,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
  schoolId: election.schoolId?.toString?.() || election.schoolId,
  subTitle: election.subTitle || "",
  imageUrl: election.imageUrl || "",
  voteCount: election.votes?.length || 0,
});

const mapStudentCategory = ({ election, category, studentId }) => ({
  _id: category._id.toString(),
  electionId: election._id.toString(),
  title: category.title,
  subTitle: category.subTitle || election.subTitle || "",
  imageUrl: category.imageUrl || "",
  totalVotes: (election.votes || []).filter(
    (vote) => vote.categoryId?.toString() === category._id.toString()
  ).length,
  hasVotedInCategory: hasStudentVotedInCategory({
    election,
    studentId,
    categoryId: category._id,
  }),
});

const mapStudentAspirant = ({ aspirant, election, studentId, electionId }) => ({
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
  hasVotedInCategory: hasStudentVotedInCategory({
    election,
    studentId,
    categoryId: aspirant.categoryId?.toString() || aspirant.electoralCategory,
  }),
});

const buildStudentCategoryPayloads = ({ election, aspirants, studentId }) => {
  if (election.categories.length > 0) {
    return election.categories.map((category) => ({
      ...mapStudentCategory({
        election,
        category,
        studentId,
      }),
      aspirants: aspirants
        .filter((aspirant) => aspirant.categoryId?.toString() === category._id.toString())
        .map((aspirant) =>
          mapStudentAspirant({
            aspirant,
            election,
            studentId,
            electionId: election._id.toString(),
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
              })
            ),
        },
      ])
    ).values()
  );
};

export const getElectionById = async (req, res) => {
  try {
    const { electionId } = req.params;
    const schoolId = getStudentSchoolId(req.student);
    const election = await Election.findById(electionId);

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

    return res.status(200).json({
      ...toElectionCard(election),
      categories: (election.categories || []).map((category) => category.title),
      eligibleVoters: election.eligibleVoters?.length || 0,
      votesCast: election.votes?.length || 0,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load election");
  }
};

export const getActiveElections = async (req, res) => {
  try {
    const schoolId = getStudentSchoolId(req.student);
    const elections = await Election.find({
      status: "active",
      ...(schoolId ? { schoolId } : {}),
    }).sort({ startTime: -1 });
    const eligibleElections = await filterEligibleElectionsForStudent({
      elections,
      student: req.student,
    });

    return res.status(200).json(eligibleElections.map(toElectionCard));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load active elections");
  }
};

export const getElectionSchedule = async (req, res) => {
  try {
    const schoolId = getStudentSchoolId(req.student);
    const elections = await Election.find({
      status: { $in: ["pending", "scheduled"] },
      ...(schoolId ? { schoolId } : {}),
    }).sort({ startTime: 1 });
    const eligibleElections = await filterEligibleElectionsForStudent({
      elections,
      student: req.student,
    });

    const schedule = eligibleElections.map((election) => ({
      _id: election._id.toString(),
      electionTitle: election.title,
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

    elections.forEach((election) => {
      election.votes.forEach((vote) => {
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
    const schoolId = getStudentSchoolId(req.student);
    const elections = await Election.find({
      status: { $in: ["active", "ended", "closed"] },
      ...(schoolId ? { schoolId } : {}),
    }).sort({ startTime: -1 });
    const eligibleElections = await filterEligibleElectionsForStudent({
      elections,
      student: req.student,
    });

    return res.status(200).json(eligibleElections.map(toElectionCard));
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

    let categories = election.categories.map((category) => ({
      ...mapStudentCategory({
        election,
        category,
        studentId: req.student?._id,
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
    const election = await Election.findById(electionId).select("schoolId votes");

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

    return res.status(200).json(
      aspirants.map((aspirant) =>
        mapStudentAspirant({
          aspirant,
          election,
          studentId: req.student?._id,
          electionId,
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

  const student = await Student.findById(studentId).select("_id schoolId");
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

  const categories = buildStudentCategoryPayloads({
    election,
    aspirants,
    studentId: student._id,
  });
  const mappedAspirants = aspirants.map((aspirant) =>
    mapStudentAspirant({
      aspirant,
      election,
      studentId: student._id,
      electionId,
    })
  );

  return {
    ...toElectionCard(election),
    updatedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    votesCast: election.votes?.length || 0,
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
