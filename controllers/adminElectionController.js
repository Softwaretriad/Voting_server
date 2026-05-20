import Election from "../models/Election.js";
import School from "../models/school.js";
import Student from "../models/Student.js";
import Aspirant from "../models/Aspirant.js";
import Voter from "../models/Voter.js";
import { sendError } from "../utils/apiResponse.js";
import { isStudentRegistryIdInElectionVoters } from "../utils/electionEligibility.js";
import { recordActivity } from "../utils/activityLog.js";
import {
  buildAspirantImageUrl,
  hasUploadedImage,
} from "../utils/aspirantImage.js";
import { getPlanConfig, syncSchoolSubscriptionState } from "../utils/plans.js";
import { hasAdminVotedInCategory } from "../utils/voteState.js";
import {
  getEligibleStudentObjectIdsForElection,
  notifyEligibleStudentsForElection,
  notifyRemovedStudentsFromElection,
  notifySchoolAdmins,
} from "../utils/notificationService.js";
import {
  emitAdminSchoolEvent,
  emitStudentScopedEvent,
} from "../utils/liveMonitorSocket.js";

const allowedStatuses = new Set(["active", "scheduled", "draft", "closed"]);

const mapElectionResponse = (election) => ({
  _id: election._id.toString(),
  title: election.title,
  status: election.status === "pending" ? "draft" : election.status,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
  imageUrl: election.imageUrl || "",
  categories: (election.categories || []).map((category) => category.title),
  // voterListUrl: election.voterListUrl || "",
  //aspirantListUrl: election.aspirantListUrl || "",
});

const mapEditAspirantResponse = (aspirant) => ({
  _id: aspirant._id.toString(),
  electionId: aspirant.electionId?.toString() || "",
  categoryId: aspirant.categoryId?.toString() || "",
  name: aspirant.name,
  studentId: aspirant.studentId || "",
  programmeOfStudy: aspirant.programmeOfStudy || "",
  level: aspirant.level || "",
  faculty: aspirant.faculty || "",
  electoralCategory: aspirant.electoralCategory || "",
  department: aspirant.faculty || "",
  imageUrl: aspirant.imageUrl || "",
  voteCount: aspirant.voteCount || 0,
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

const buildAspirantDocs = async ({ aspirants = [], election, schoolId, req }) => {
  const categoryByTitle = new Map(
    (election.categories || []).map((category) => [category.title, category])
  );

  const docs = await Promise.all(
    aspirants.map(async (aspirant) => {
      const electoralCategory = String(aspirant.electoralCategory || "").trim();
      const name = String(aspirant.name || "").trim();
      const studentId = String(aspirant.studentId || "").trim();

      if (!name || !electoralCategory) {
        return null;
      }

      const category = categoryByTitle.get(electoralCategory);
      const providedImageUrl = String(aspirant.imageUrl || "").trim();
      const imageUrl =
        providedImageUrl ||
        ((studentId && (await hasUploadedImage(studentId)))
          ? buildAspirantImageUrl(req, studentId)
          : "");

      return {
        name,
        studentId,
        programmeOfStudy: String(aspirant.programmeOfStudy || "").trim(),
        level: String(aspirant.level || "").trim(),
        faculty: String(aspirant.faculty || "").trim(),
        electoralCategory,
        schoolId,
        electionId: election._id,
        categoryId: category?._id || null,
        imageUrl,
        title: election.title,
        voteCount: 0,
      };
    })
  );

  return docs.filter(Boolean);
};

const parseStatus = (status) => (status === "pending" ? "draft" : status);

const mapAdminCategoryResponse = ({ election, category, adminId, isInVotersList }) => ({
  _id: category._id.toString(),
  electionId: election._id.toString(),
  title: category.title,
  subTitle: category.subTitle || election.subTitle || "",
  imageUrl: category.imageUrl || "",
  totalVotes: (election.votes || []).filter(
    (vote) => vote.categoryId?.toString() === category._id.toString()
  ).length,
  hasVotedInCategory: hasAdminVotedInCategory({
    election,
    adminId,
    categoryId: category._id,
  }),
  isInVotersList: Boolean(isInVotersList),
});

const buildStudentHomeElectionEventPayload = (election, statusOverride = null) => ({
  electionId: election._id.toString(),
  status: statusOverride || parseStatus(election.status),
  title: election.title,
  schoolId: election.schoolId?.toString?.() || election.schoolId,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
});

const buildAdminHomeElectionEventPayload = (election, statusOverride = null) => ({
  electionId: election._id.toString(),
  status: statusOverride || parseStatus(election.status),
  title: election.title,
  schoolId: election.schoolId?.toString?.() || election.schoolId,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
});

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
    const election = await Election.findOne({ _id: req.params.electionId, schoolId: req.schoolId });

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    const [aspirants, storedVoterCount] = await Promise.all([
      Aspirant.find({ electionId: election._id, schoolId: req.schoolId })
        .sort({ electoralCategory: 1, name: 1 })
        .select("name studentId programmeOfStudy level faculty electoralCategory imageUrl"),
      Voter.countDocuments({ electionId: election._id, schoolId: req.schoolId }),
    ]);

    return res.status(200).json({
      _id: election._id.toString(),
      title: election.title,
      status: parseStatus(election.status),
      startDate: election.startTime ? election.startTime.toISOString() : null,
      endDate: election.endTime ? election.endTime.toISOString() : null,
      categories: (election.categories || []).map((category) => category.title),
      voterCount: storedVoterCount || election.eligibleVoters?.length || 0,
      aspirants: aspirants.map(mapEditAspirantResponse),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load election");
  }
};

export const getAdminElectionCategories = async (req, res) => {
  try {
    const election = await Election.findOne({
      _id: req.params.electionId,
      schoolId: req.schoolId,
    }).select("schoolId subTitle categories votes");

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    const isInVotersList = await isStudentRegistryIdInElectionVoters({
      election,
      schoolId: req.schoolId,
      studentRegistryId: req.ecUser?.studentId,
    });

    let categories = (election.categories || []).map((category) =>
      mapAdminCategoryResponse({
        election,
        category,
        adminId: req.ecUser?._id,
        isInVotersList,
      })
    );

    if (categories.length === 0) {
      const aspirants = await Aspirant.find({
        electionId: election._id,
        schoolId: req.schoolId,
      }).select("categoryId electoralCategory imageUrl");

      categories = Array.from(
        new Map(
          aspirants.map((aspirant) => [
            aspirant.categoryId?.toString() || aspirant.electoralCategory,
            mapAdminCategoryResponse({
              election,
              category: {
                _id: aspirant.categoryId?.toString() || aspirant.electoralCategory,
                title: aspirant.electoralCategory,
                subTitle: election.subTitle || "",
                imageUrl: aspirant.imageUrl || "",
              },
              adminId: req.ecUser?._id,
              isInVotersList,
            }),
          ])
        ).values()
      );
    }

    return res.status(200).json(categories);
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load election categories");
  }
};

export const getAdminElectionAspirants = async (req, res) => {
  try {
    const { electionId } = req.params;
    const { categoryId } = req.query;

    const election = await Election.findOne({
      _id: electionId,
      schoolId: req.schoolId,
    }).select("_id votes");

    if (!election) {
      return sendError(res, 404, "Election not found");
    }
    const isInVotersList = await isStudentRegistryIdInElectionVoters({
      election,
      schoolId: req.schoolId,
      studentRegistryId: req.ecUser?.studentId,
    });

    const filter = {
      electionId,
      schoolId: req.schoolId,
    };

    if (categoryId) {
      filter.$or = [{ categoryId }, { electoralCategory: categoryId }];
    }

    const aspirants = await Aspirant.find(filter)
      .sort({ electoralCategory: 1, name: 1 })
      .select(
        "name studentId programmeOfStudy level faculty electoralCategory imageUrl electionId categoryId voteCount"
      );

    return res.status(200).json(
      aspirants.map((aspirant) => ({
        ...mapEditAspirantResponse(aspirant),
        hasVotedInCategory: hasAdminVotedInCategory({
          election,
          adminId: req.ecUser?._id,
          categoryId: aspirant.categoryId?.toString() || aspirant.electoralCategory,
        }),
        isInVotersList,
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load election aspirants");
  }
};

export const createAdminElection = async (req, res) => {
  try {
    const {
      title,
      imageUrl = "",
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
      imageUrl: String(imageUrl || "").trim(),
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

    const aspirantDocs = await buildAspirantDocs({
      aspirants,
      election,
      schoolId: req.schoolId,
      req,
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
    await notifySchoolAdmins({
      schoolId: req.schoolId,
      type: "election_created",
      title: "Election created",
      message: `${election.title} was created successfully.`,
      priority: "normal",
      data: { electionId: election._id.toString(), electionTitle: election.title },
    });
    if (voterDocs.length > 0) {
      await notifySchoolAdmins({
        schoolId: req.schoolId,
        type: "voter_list_uploaded_successfully",
        title: "Voter list uploaded",
        message: `${voterDocs.length} voter records were uploaded for ${election.title}.`,
        priority: "normal",
        data: { electionId: election._id.toString(), count: voterDocs.length },
      });
    }
    if (aspirantDocs.length > 0) {
      await notifySchoolAdmins({
        schoolId: req.schoolId,
        type: "aspirant_list_uploaded_successfully",
        title: "Aspirant list uploaded",
        message: `${aspirantDocs.length} aspirant records were uploaded for ${election.title}.`,
        priority: "normal",
        data: { electionId: election._id.toString(), count: aspirantDocs.length },
      });
    }
    if (election.status === "scheduled") {
      await notifyEligibleStudentsForElection({
        election,
        type: "election_scheduled",
        title: "Election scheduled",
        message: `${election.title} has been scheduled.`,
        priority: "normal",
      });
      await emitStudentScopedEvent({
        eventName: "election:scheduled",
        studentIds: await getEligibleStudentObjectIdsForElection(election),
        payload: buildStudentHomeElectionEventPayload(election, "scheduled"),
      });
      await emitAdminSchoolEvent({
        eventName: "admin:election:scheduled",
        schoolId: election.schoolId,
        payload: buildAdminHomeElectionEventPayload(election, "scheduled"),
      });
    }

    return res.status(201).json(mapElectionResponse(election));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to create election");
  }
};

export const updateAdminElection = async (req, res) => {
  try {
    const { electionId } = req.params;
    const election = await Election.findOne({ _id: electionId, schoolId: req.schoolId });
    const previousStatus = parseStatus(election?.status);

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    const {
      title,
      imageUrl,
      startDate,
      endDate,
      categories,
      status,
      keepExistingVoters,
      voters,
      aspirants,
      voterListUrl,
      aspirantListUrl,
    } = req.body;
    const previousEligibleStudentIds = new Set(
      (election.eligibleVoters || [])
        .map((voter) => String(voter.studentId || "").trim())
        .filter(Boolean)
    );

    if (title != null) election.title = title;
    if (imageUrl != null) election.imageUrl = String(imageUrl || "").trim();
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
    } else if (keepExistingVoters === true) {
      // Intentionally preserve the existing voter registry and voter count.
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
      const nextEligibleStudentIds = new Set(
        normalizeEligibleVoters(voters)
          .map((voter) => String(voter.studentId || "").trim())
          .filter(Boolean)
      );
      const removedStudentIds = Array.from(previousEligibleStudentIds).filter(
        (studentId) => !nextEligibleStudentIds.has(studentId)
      );
      await notifyRemovedStudentsFromElection({
        schoolId: req.schoolId,
        electionId: election._id,
        electionTitle: election.title,
        removedStudentRegistryIds: removedStudentIds,
      });
      await notifySchoolAdmins({
        schoolId: req.schoolId,
        type: "voter_list_uploaded_successfully",
        title: "Voter list uploaded",
        message: `${voterDocs.length} voter records were uploaded for ${election.title}.`,
        priority: "normal",
        data: { electionId: election._id.toString(), count: voterDocs.length },
      });
    }

    if (aspirants != null) {
      await Aspirant.deleteMany({ electionId: election._id });
      const aspirantDocs = await buildAspirantDocs({
        aspirants,
        election,
        schoolId: req.schoolId,
        req,
      });
      if (aspirantDocs.length > 0) {
        await Aspirant.insertMany(aspirantDocs);
      }
      await notifySchoolAdmins({
        schoolId: req.schoolId,
        type: "aspirant_list_uploaded_successfully",
        title: "Aspirant list uploaded",
        message: `${aspirantDocs.length} aspirant records were uploaded for ${election.title}.`,
        priority: "normal",
        data: { electionId: election._id.toString(), count: aspirantDocs.length },
      });
    }

    await recordActivity({
      actorType: "admin",
      actorId: req.ecUser._id,
      schoolId: req.schoolId,
      action: "Election Updated",
      metadata: { electionId: election._id, status: election.status },
    });
    await notifySchoolAdmins({
      schoolId: req.schoolId,
      type: "election_updated",
      title: "Election updated",
      message: `${election.title} was updated successfully.`,
      priority: "normal",
      data: { electionId: election._id.toString(), electionTitle: election.title },
    });
    if (previousStatus !== "scheduled" && election.status === "scheduled") {
      await notifyEligibleStudentsForElection({
        election,
        type: "election_scheduled",
        title: "Election scheduled",
        message: `${election.title} has been scheduled.`,
        priority: "normal",
      });
      await emitStudentScopedEvent({
        eventName: "election:scheduled",
        studentIds: await getEligibleStudentObjectIdsForElection(election),
        payload: buildStudentHomeElectionEventPayload(election, "scheduled"),
      });
      await emitAdminSchoolEvent({
        eventName: "admin:election:scheduled",
        schoolId: election.schoolId,
        payload: buildAdminHomeElectionEventPayload(election, "scheduled"),
      });
    }
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
    await notifySchoolAdmins({
      schoolId: req.schoolId,
      type: "election_scheduled",
      title: "Election scheduled",
      message: `${election.title} has been scheduled.`,
      priority: "normal",
      data: { electionId: election._id.toString(), electionTitle: election.title },
    });
    await notifyEligibleStudentsForElection({
      election,
      type: "election_scheduled",
      title: "Election scheduled",
      message: `${election.title} has been scheduled.`,
      priority: "normal",
    });
    await emitStudentScopedEvent({
      eventName: "election:scheduled",
      studentIds: await getEligibleStudentObjectIdsForElection(election),
      payload: buildStudentHomeElectionEventPayload(election, "scheduled"),
    });
    await emitAdminSchoolEvent({
      eventName: "admin:election:scheduled",
      schoolId: election.schoolId,
      payload: buildAdminHomeElectionEventPayload(election, "scheduled"),
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

    if (parseStatus(election.status) === "active") {
      return sendError(res, 403, "Active elections cannot be deleted");
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
    await notifySchoolAdmins({
      schoolId: req.schoolId,
      type: "election_deleted",
      title: "Election deleted",
      message: `${election.title} was deleted.`,
      priority: "normal",
      data: { electionId: election._id.toString(), electionTitle: election.title },
    });
    return res.status(200).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to delete election");
  }
};
