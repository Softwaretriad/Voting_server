import Election from "../models/Election.js";
import School from "../models/school.js";
import Student from "../models/Student.js";
import Aspirant from "../models/Aspirant.js";
import Voter from "../models/Voter.js";
import { sendError } from "../utils/apiResponse.js";
import { recordActivity } from "../utils/activityLog.js";
import { getPlanConfig, syncSchoolSubscriptionState } from "../utils/plans.js";

const allowedStatuses = new Set(["active", "scheduled", "draft", "closed"]);

const mapElectionResponse = (election) => ({
  _id: election._id.toString(),
  title: election.title,
  status: election.status === "pending" ? "draft" : election.status,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
  categories: (election.categories || []).map((category) => category.title),
  // voterListUrl: election.voterListUrl || "",
  //aspirantListUrl: election.aspirantListUrl || "",
});

const normalizeCategories = (categories = []) =>
  categories.map((category) => ({
    title: String(category).trim(),
    subTitle: "",
    imageUrl: "",
  }));

const normalizeEligibleVoters = (voters = []) =>
  voters.map((voter) => ({
    name: String(voter.name || "").trim(),
    studentId: String(voter.studentId || "").trim(),
    programmeOfStudy: String(voter.programmeOfStudy || "").trim(),
    level: String(voter.level || "").trim(),
    faculty: String(voter.faculty || "").trim(),
  }));

const buildVoterDocs = ({ voters = [], election, schoolId }) =>
  normalizeEligibleVoters(voters)
    .filter((voter) => voter.name && voter.studentId)
    .map((voter) => ({
      ...voter,
      schoolId,
      electionId: election._id,
      source: "upload",
    }));

const buildAspirantDocs = ({ aspirants = [], election, schoolId }) => {
  const categoryByTitle = new Map(
    (election.categories || []).map((category) => [category.title, category])
  );

  return aspirants
    .map((aspirant) => {
      const electoralCategory = String(aspirant.electoralCategory || "").trim();
      const name = String(aspirant.name || "").trim();

      if (!name || !electoralCategory) {
        return null;
      }

      const category = categoryByTitle.get(electoralCategory);

      return {
        name,
        studentId: String(aspirant.studentId || "").trim(),
        programmeOfStudy: String(aspirant.programmeOfStudy || "").trim(),
        level: String(aspirant.level || "").trim(),
        faculty: String(aspirant.faculty || "").trim(),
        electoralCategory,
        schoolId,
        electionId: election._id,
        categoryId: category?._id || null,
        imageUrl: String(aspirant.imageUrl || "").trim(),
        title: election.title,
        voteCount: 0,
      };
    })
    .filter(Boolean);
};

const parseStatus = (status) => (status === "pending" ? "draft" : status);

const validateElectionWindow = ({ start, end, school }) => {
  const now = new Date();

  if (start <= now) {
    return "startDate must be in the future";
  }

  if (end <= now) {
    return "endDate must be in the future";
  }

  if (end <= start) {
    return "endDate must be after startDate";
  }

  if (school?.subscriptionExpiresAt) {
    const subscriptionExpiry = new Date(school.subscriptionExpiresAt);
    if (end > subscriptionExpiry) {
      return "endDate cannot be later than the school's subscription expiry date";
    }
  }

  return null;
};

const validateElectionStartEligibility = async (schoolId) => {
  const school = await School.findById(schoolId).select(
    "plan subscriptionActive subscriptionExpiresAt subscriptionTerm oneOffElectionConsumed shortName"
  );

  if (!school) {
    return { error: "School not found" };
  }

  syncSchoolSubscriptionState(school);
  await school.save();

  if (!school.subscriptionActive) {
    return { error: "Active subscription required to start or schedule elections" };
  }

  if (
    school.subscriptionTerm === "one_off_election" &&
    school.oneOffElectionConsumed
  ) {
    return { error: "This one-off election subscription has already been used" };
  }

  const studentCount = await Student.countDocuments({ schoolId });
  const planConfig = getPlanConfig(school.plan);
  if (studentCount > planConfig.maxVoters) {
    return {
      error: `This subscription supports up to ${planConfig.maxVoters} students`,
    };
  }

  return { school };
};

export const getAdminElectionsByStatus = async (req, res) => {
  try {
    const status = parseStatus(req.query.status);

    if (!allowedStatuses.has(status)) {
      return sendError(res, 400, "status query must be one of active, scheduled, draft, or closed");
    }

    const elections = await Election.find({
      schoolId: req.schoolId,
      status,
    }).sort({ startTime: -1, createdAt: -1 });

    return res.status(200).json(elections.map(mapElectionResponse));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load elections");
  }
};

export const getAdminElectionById = async (req, res) => {
  try {
    const election = await Election.findOne({
      _id: req.params.electionId,
      schoolId: req.schoolId,
    });

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    return res.status(200).json({
      ...mapElectionResponse(election),
      categories: (election.categories || []).map((category) => category.title),
      votesCast: election.votes?.length || 0,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load election");
  }
};

export const createAdminElection = async (req, res) => {
  try {
    const {
      title,
      startDate,
      endDate,
      categories,
      status,
      voters = [],
      aspirants = [],
      voterListUrl = "",
      aspirantListUrl = "",
    } = req.body;

    if (!title || !startDate || !endDate || !Array.isArray(categories) || categories.length === 0 || !status) {
      return sendError(res, 400, "title, startDate, endDate, categories, and status are required");
    }

    const normalizedCategoryTitles = categories.map((category) => String(category).trim());
    const invalidAspirant = aspirants.find((aspirant) => {
      const electoralCategory = String(aspirant.electoralCategory || "").trim();
      return !electoralCategory || !normalizedCategoryTitles.includes(electoralCategory);
    });
    if (invalidAspirant) {
      return sendError(
        res,
        400,
        "Each aspirant.electoralCategory must match one of the provided categories"
      );
    }

    const normalizedStatus = parseStatus(status);
    if (!["draft", "scheduled"].includes(normalizedStatus)) {
      return sendError(res, 400, "status must be draft or scheduled");
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return sendError(res, 400, "startDate and endDate must be valid ISO datetimes");
    }

    const schoolEligibility = await validateElectionStartEligibility(req.schoolId);
    if (schoolEligibility.error) {
      return sendError(res, 403, schoolEligibility.error);
    }

    const school =
      schoolEligibility.school ||
      (await School.findById(req.schoolId).select("shortName subscriptionExpiresAt"));
    const dateError = validateElectionWindow({ start, end, school });
    if (dateError) {
      return sendError(res, 400, dateError);
    }

    const election = await Election.create({
      schoolId: req.schoolId,
      title,
      startTime: start,
      endTime: end,
      categories: normalizeCategories(normalizedCategoryTitles),
      eligibleVoters: normalizeEligibleVoters(voters),
      candidates: aspirants
        .map((aspirant) => ({
          name: String(aspirant.name || "").trim(),
          position: String(aspirant.electoralCategory || "").trim(),
        }))
        .filter((aspirant) => aspirant.name && aspirant.position),
      status: normalizedStatus,
      voterListUrl,
      aspirantListUrl,
      subTitle: school?.shortName || "",
    });

    const aspirantDocs = buildAspirantDocs({
      aspirants,
      election,
      schoolId: req.schoolId,
    });
    if (aspirantDocs.length > 0) {
      await Aspirant.insertMany(aspirantDocs);
    }

    const voterDocs = buildVoterDocs({
      voters,
      election,
      schoolId: req.schoolId,
    });
    if (voterDocs.length > 0) {
      await Voter.insertMany(voterDocs);
    }

    await recordActivity({
      actorType: "admin",
      actorId: req.ecUser._id,
      schoolId: req.schoolId,
      action: "Election Created",
      metadata: {
        electionId: election._id,
        status: election.status,
        votersImported: voterDocs.length,
        aspirantsImported: aspirantDocs.length,
      },
    });

    return res.status(201).json(mapElectionResponse(election));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to create election");
  }
};

export const updateAdminElection = async (req, res) => {
  try {
    const { electionId } = req.params;
    const election = await Election.findOne({ _id: electionId, schoolId: req.schoolId });

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    const {
      title,
      startDate,
      endDate,
      categories,
      status,
      voters,
      aspirants,
      voterListUrl,
      aspirantListUrl,
    } = req.body;

    if (title != null) election.title = title;
    if (startDate != null) {
      const start = new Date(startDate);
      if (Number.isNaN(start.getTime())) {
        return sendError(res, 400, "startDate must be a valid ISO datetime");
      }
      election.startTime = start;
    }
    if (endDate != null) {
      const end = new Date(endDate);
      if (Number.isNaN(end.getTime())) {
        return sendError(res, 400, "endDate must be a valid ISO datetime");
      }
      election.endTime = end;
    }
    if (categories != null) {
      if (!Array.isArray(categories) || categories.length === 0) {
        return sendError(res, 400, "categories must be a non-empty array");
      }
      election.categories = normalizeCategories(categories);
    }
    if (voters != null) {
      if (!Array.isArray(voters) || voters.length === 0) {
        return sendError(res, 400, "voters must be a non-empty array when provided");
      }
      election.eligibleVoters = normalizeEligibleVoters(voters);
    }
    if (status != null) {
      const normalizedStatus = parseStatus(status);
      if (!["draft", "scheduled"].includes(normalizedStatus)) {
        return sendError(res, 400, "Only draft and scheduled elections can be updated through this route");
      }
      if (normalizedStatus === "scheduled") {
        const schoolEligibility = await validateElectionStartEligibility(req.schoolId);
        if (schoolEligibility.error) {
          return sendError(res, 403, schoolEligibility.error);
        }
      }
      election.status = normalizedStatus;
    }
    if (voterListUrl != null) election.voterListUrl = voterListUrl;
    if (aspirantListUrl != null) election.aspirantListUrl = aspirantListUrl;
    if (aspirants != null) {
      if (!Array.isArray(aspirants) || aspirants.length === 0) {
        return sendError(res, 400, "aspirants must be a non-empty array when provided");
      }

      const normalizedCategoryTitles = (election.categories || []).map((category) =>
        String(category.title).trim()
      );
      const invalidAspirant = aspirants.find((aspirant) => {
        const electoralCategory = String(aspirant.electoralCategory || "").trim();
        return !electoralCategory || !normalizedCategoryTitles.includes(electoralCategory);
      });

      if (invalidAspirant) {
        return sendError(
          res,
          400,
          "Each aspirant.electoralCategory must match one of the provided categories"
        );
      }

      election.candidates = aspirants
        .map((aspirant) => ({
          name: String(aspirant.name || "").trim(),
          position: String(aspirant.electoralCategory || "").trim(),
        }))
        .filter((aspirant) => aspirant.name && aspirant.position);
    }

    if (
      election.startTime &&
      election.endTime &&
      new Date(election.endTime) <= new Date(election.startTime)
    ) {
      return sendError(res, 400, "endDate must be after startDate");
    }

    if (!election.startTime || !election.endTime) {
      return sendError(res, 400, "startDate and endDate are required");
    }

    const schoolEligibility = await validateElectionStartEligibility(req.schoolId);
    if (schoolEligibility.error) {
      return sendError(res, 403, schoolEligibility.error);
    }

    const dateError = validateElectionWindow({
      start: new Date(election.startTime),
      end: new Date(election.endTime),
      school: schoolEligibility.school,
    });
    if (dateError) {
      return sendError(res, 400, dateError);
    }

    await election.save();

    if (voters != null) {
      await Voter.deleteMany({ electionId: election._id });
      const voterDocs = buildVoterDocs({
        voters,
        election,
        schoolId: req.schoolId,
      });
      if (voterDocs.length > 0) {
        await Voter.insertMany(voterDocs);
      }
    }

    if (aspirants != null) {
      await Aspirant.deleteMany({ electionId: election._id });
      const aspirantDocs = buildAspirantDocs({
        aspirants,
        election,
        schoolId: req.schoolId,
      });
      if (aspirantDocs.length > 0) {
        await Aspirant.insertMany(aspirantDocs);
      }
    }

    await recordActivity({
      actorType: "admin",
      actorId: req.ecUser._id,
      schoolId: req.schoolId,
      action: "Election Updated",
      metadata: { electionId: election._id, status: election.status },
    });
    return res.status(200).json(mapElectionResponse(election));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to update election");
  }
};

export const scheduleAdminElection = async (req, res) => {
  try {
    const election = await Election.findOne({
      _id: req.params.electionId,
      schoolId: req.schoolId,
    });

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    if (parseStatus(election.status) !== "draft") {
      return sendError(res, 400, "Only draft elections can be scheduled");
    }

    if (!election.startTime || !election.endTime) {
      return sendError(
        res,
        400,
        "Election startDate and endDate are required before scheduling"
      );
    }

    const schoolEligibility = await validateElectionStartEligibility(req.schoolId);
    if (schoolEligibility.error) {
      return sendError(res, 403, schoolEligibility.error);
    }

    const dateError = validateElectionWindow({
      start: new Date(election.startTime),
      end: new Date(election.endTime),
      school: schoolEligibility.school,
    });
    if (dateError) {
      return sendError(res, 400, dateError);
    }

    election.status = "scheduled";
    await election.save();
    await recordActivity({
      actorType: "admin",
      actorId: req.ecUser._id,
      schoolId: req.schoolId,
      action: "Election Scheduled",
      metadata: { electionId: election._id },
    });
    return res.status(200).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to schedule election");
  }
};

export const deleteAdminElection = async (req, res) => {
  try {
    const election = await Election.findOne({
      _id: req.params.electionId,
      schoolId: req.schoolId,
    });

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    if (!["draft", "scheduled"].includes(parseStatus(election.status))) {
      return sendError(res, 403, "Only draft or scheduled elections can be deleted");
    }

    await Voter.deleteMany({ electionId: election._id });
    await Aspirant.deleteMany({ electionId: election._id });
    await Election.deleteOne({ _id: election._id });
    await recordActivity({
      actorType: "admin",
      actorId: req.ecUser._id,
      schoolId: req.schoolId,
      action: "Election Deleted",
      metadata: { electionId: election._id },
    });
    return res.status(200).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to delete election");
  }
};
