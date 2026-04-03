import Candidate from "../models/candidates.js";
import Election from "../models/Election.js";
import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";

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
});

export const getActiveElections = async (req, res) => {
  try {
    const schoolId = getStudentSchoolId(req.student);
    const elections = await Election.find({
      status: "active",
      ...(schoolId ? { schoolId } : {}),
    }).sort({ startTime: -1 });

    return res.status(200).json(elections.map(toElectionCard));
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

    const schedule = elections.map((election) => ({
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

    return res.status(200).json(elections.map(toElectionCard));
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

    let categories = election.categories.map((category) => ({
      _id: category._id.toString(),
      electionId: election._id.toString(),
      title: category.title,
      subTitle: category.subTitle || election.subTitle || "",
      imageUrl: category.imageUrl || "",
    }));

    if (categories.length === 0) {
      const aspirants = await Candidate.find({ electionId: election._id });
      categories = Array.from(
        new Map(
          aspirants.map((aspirant) => [
            aspirant.categoryId?.toString() || aspirant.position,
            {
              _id: aspirant.categoryId?.toString() || aspirant.position,
              electionId: election._id.toString(),
              title: aspirant.position,
              subTitle: election.subTitle || "",
              imageUrl: "",
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
    const aspirants = await Candidate.find({
      electionId,
      ...(schoolId ? { schoolId } : {}),
    }).sort({ name: 1 });

    return res.status(200).json(
      aspirants.map((aspirant) => ({
        _id: aspirant._id.toString(),
        electionId: aspirant.electionId?.toString() || electionId,
        name: aspirant.name,
        department: aspirant.department || "",
        imageUrl: aspirant.imageUrl || "",
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load aspirants");
  }
};

export const getCategoryResults = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const schoolId = getStudentSchoolId(req.student);
    const aspirants = await Candidate.find({
      ...(schoolId ? { schoolId } : {}),
      $or: [{ categoryId }, { position: categoryId }],
    }).sort({ voteCount: -1, name: 1 });

    return res.status(200).json(
      aspirants.map((aspirant) => ({
        _id: aspirant._id.toString(),
        categoryId: aspirant.categoryId?.toString() || aspirant.position,
        name: aspirant.name,
        department: aspirant.department || "",
        voteCount: aspirant.voteCount || 0,
        imageUrl: aspirant.imageUrl || "",
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load category results");
  }
};
