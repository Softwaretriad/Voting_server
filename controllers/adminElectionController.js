import Election from "../models/Election.js";
import School from "../models/school.js";
import Student from "../models/Student.js";
import Aspirant from "../models/Aspirant.js";
import { sendError } from "../utils/apiResponse.js";
import { isStudentRegistryIdInElectionVoters } from "../utils/electionEligibility.js";
import { recordActivity } from "../utils/activityLog.js";
import { getUploadedImageFilePath } from "../utils/aspirantImage.js";
import { getElectionImageFilePath } from "../utils/electionImage.js";
import { getPlanConfig, syncSchoolSubscriptionState } from "../utils/plans.js";
import {
  getEligibleStudentObjectIdsForElection,
  notifyEligibleStudentsForElection,
  notifySchoolAdmins,
} from "../utils/notificationService.js";
import {
  emitAdminSchoolEvent,
  emitStudentScopedEvent,
} from "../utils/liveMonitorSocket.js";
import { getStoredVotesForElection } from "../utils/voteStore.js";
import { buildPaginationMeta, getPagination } from "../utils/pagination.js";
import { EC_ROLE } from "../utils/ecRole.js";
import {
  buildAudienceStudentQuery,
  normalizeElectionAudience,
  validateElectionAudience,
} from "../utils/electionAudience.js";

const allowedStatuses = new Set(["active", "scheduled", "draft", "closed"]);
const MIN_ELECTION_START_DELAY_MS = 24 * 60 * 60 * 1000;
const FREE_PLAN_ELECTION_INTERVAL_MONTHS = 2;

const mapElectionResponse = (election) => ({
  _id: election._id.toString(),
  title: election.title,
  status: election.status === "pending" ? "draft" : election.status,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
  imageUrl: election.imageUrl || "",
  audience: normalizeElectionAudience(election.audience),
  categories: (election.categories || []).map((category) => category.title),
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

const resolveElectionAudience = (body = {}) =>
  normalizeElectionAudience(body.audience || {
    scope: body.audienceScope || "all_students",
    faculties: body.faculties,
    nationalities: body.nationalities,
  });

const validateEcElectionAudience = (audience) => validateElectionAudience(audience);

const resolveAspirantImageUrl = async ({ aspirant, req }) => {
  const providedImageUrl = String(aspirant.imageUrl || "").trim();
  if (!providedImageUrl) {
    return "";
  }

  const rawPath = providedImageUrl.startsWith("/")
    ? providedImageUrl
    : (() => {
        try {
          return new URL(providedImageUrl).pathname;
        } catch {
          return "";
        }
      })();

  if (rawPath.includes("/uploads/images/") && !rawPath.includes("/uploads/images/files/")) {
    return "";
  }

  try {
    if (rawPath.includes("/uploads/images/files/")) {
      const filename = decodeURIComponent(rawPath.split("/").pop() || "");
      const imagePath = await getUploadedImageFilePath(filename);
      return imagePath ? providedImageUrl : "";
    }
  } catch {
    return providedImageUrl;
  }

  return providedImageUrl;
};

const resolveElectionImageUrl = async ({ imageUrl, req }) => {
  const providedImageUrl = String(imageUrl || "").trim();
  if (!providedImageUrl) {
    return "";
  }

  const rawPath = providedImageUrl.startsWith("/")
    ? providedImageUrl
    : (() => {
        try {
          return new URL(providedImageUrl).pathname;
        } catch {
          return "";
        }
      })();

  if (
    rawPath.includes("/uploads/election-images/") &&
    !rawPath.includes("/uploads/election-images/files/")
  ) {
    return "";
  }

  try {
    if (rawPath.includes("/uploads/election-images/files/")) {
      const filename = decodeURIComponent(rawPath.split("/").pop() || "");
      const imagePath = await getElectionImageFilePath(filename);
      return imagePath ? providedImageUrl : "";
    }
  } catch {
    return providedImageUrl;
  }

  return providedImageUrl;
};

const findAspirantsMissingImages = async ({ aspirants = [], req }) => {
  const checks = await Promise.all(
    aspirants.map(async (aspirant, index) => {
      const name = String(aspirant.name || "").trim();
      const electoralCategory = String(aspirant.electoralCategory || "").trim();

      if (!name || !electoralCategory) {
        return null;
      }

      const imageUrl = await resolveAspirantImageUrl({ aspirant, req });
      if (imageUrl) {
        return null;
      }

      return {
        index,
        name,
        studentId: String(aspirant.studentId || "").trim(),
        electoralCategory,
      };
    })
  );

  return checks.filter(Boolean);
};

const resolveValidAspirantImageRefs = async ({ aspirants = [], req }) => {
  const refs = await Promise.all(
    aspirants.map(async (aspirant, index) => {
      const name = String(aspirant.name || "").trim();
      const electoralCategory = String(aspirant.electoralCategory || "").trim();

      if (!name || !electoralCategory) {
        return null;
      }

      return {
        index,
        name,
        studentId: String(aspirant.studentId || "").trim(),
        electoralCategory,
        imageUrl: await resolveAspirantImageUrl({ aspirant, req }),
      };
    })
  );

  return refs.filter((ref) => ref?.imageUrl);
};

const findDuplicateAspirantImageRefs = (imageRefs = []) => {
  const seen = new Map();
  const duplicates = [];

  imageRefs.forEach((ref) => {
    const existing = seen.get(ref.imageUrl);
    if (existing) {
      duplicates.push({ first: existing, duplicate: ref });
      return;
    }
    seen.set(ref.imageUrl, ref);
  });

  return duplicates;
};

const findAspirantImageOwnershipConflicts = async ({
  imageRefs = [],
  schoolId,
  electionId = null,
}) => {
  const imageUrls = Array.from(new Set(imageRefs.map((ref) => ref.imageUrl).filter(Boolean)));
  if (imageUrls.length === 0) {
    return [];
  }

  const filter = {
    schoolId,
    imageUrl: { $in: imageUrls },
  };
  if (electionId) {
    filter.electionId = { $ne: electionId };
  }

  return Aspirant.find(filter).select("name studentId electionId imageUrl").lean();
};

const validateAspirantImageOwnership = async ({ aspirants, req, electionId = null }) => {
  const imageRefs = await resolveValidAspirantImageRefs({ aspirants, req });
  const duplicateImageRefs = findDuplicateAspirantImageRefs(imageRefs);
  if (duplicateImageRefs.length > 0) {
    return {
      error: "Each aspirant photo must be unique to one aspirant",
      details: { aspirants: duplicateImageRefs },
    };
  }

  const imageConflicts = await findAspirantImageOwnershipConflicts({
    imageRefs,
    schoolId: req.schoolId,
    electionId,
  });
  if (imageConflicts.length > 0) {
    return {
      error: "Aspirant photo is already tied to another aspirant or election",
      details: { aspirants: imageConflicts },
    };
  }

  return null;
};

const validateElectionImageOwnership = async ({ imageUrl, req, electionId = null }) => {
  if (!imageUrl) {
    return null;
  }

  const filter = {
    schoolId: req.schoolId,
    imageUrl,
  };
  if (electionId) {
    filter._id = { $ne: electionId };
  }

  const existingElection = await Election.findOne(filter).select("_id title imageUrl").lean();
  if (!existingElection) {
    return null;
  }

  return {
    error: "Election image is already tied to another election",
    details: { election: existingElection },
  };
};

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
      const imageUrl = await resolveAspirantImageUrl({ aspirant, req });

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

const countVotesInCategory = (votes = [], categoryId) =>
  votes.filter((vote) => vote.categoryId?.toString() === String(categoryId)).length;

const hasEcVoteInCategory = ({ votes = [], ecUserId, categoryId }) =>
  votes.some(
    (vote) =>
      (vote.ecUserId || vote.voterId)?.toString() === String(ecUserId) &&
      vote.categoryId?.toString() === String(categoryId)
  );

const mapAdminCategoryResponse = ({ election, category, ecUserId, isInVotersList, votes = [] }) => ({
  _id: category._id.toString(),
  electionId: election._id.toString(),
  title: category.title,
  subTitle: category.subTitle || election.subTitle || "",
  imageUrl: category.imageUrl || "",
  totalVotes: countVotesInCategory(votes, category._id),
  hasVotedInCategory: hasEcVoteInCategory({
    votes,
    ecUserId,
    categoryId: category._id,
  }),
  isInVotersList: Boolean(isInVotersList),
});

const buildStudentHomeElectionEventPayload = (election, statusOverride = null) => ({
  electionId: election._id.toString(),
  status: statusOverride || parseStatus(election.status),
  title: election.title,
  imageUrl: election.imageUrl || "",
  schoolId: election.schoolId?.toString?.() || election.schoolId,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
  listScope:
    (statusOverride || parseStatus(election.status)) === "scheduled"
      ? "schedule"
      : (statusOverride || parseStatus(election.status)) === "active"
        ? "active"
        : "results",
  isScheduled: (statusOverride || parseStatus(election.status)) === "scheduled",
  isActive: (statusOverride || parseStatus(election.status)) === "active",
});

const buildAdminHomeElectionEventPayload = (election, statusOverride = null) => ({
  electionId: election._id.toString(),
  status: statusOverride || parseStatus(election.status),
  title: election.title,
  imageUrl: election.imageUrl || "",
  schoolId: election.schoolId?.toString?.() || election.schoolId,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
});

const validateElectionWindow = ({ start, end, school }) => {
  const now = new Date();
  const minimumStartTime = new Date(now.getTime() + MIN_ELECTION_START_DELAY_MS);

  if (start < minimumStartTime) {
    return "startDate must be at least 24 hours in the future";
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

const addUtcMonths = (date, months) =>
  new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );

const validateFreePlanElectionCadence = async ({
  school,
  schoolId,
  start,
  excludeElectionId = null,
}) => {
  if (school?.plan !== "free") {
    return null;
  }

  const windowStart = addUtcMonths(start, -FREE_PLAN_ELECTION_INTERVAL_MONTHS);
  const windowEnd = addUtcMonths(start, FREE_PLAN_ELECTION_INTERVAL_MONTHS);
  const filter = {
    schoolId,
    status: { $in: ["scheduled", "active", "closed"] },
    startTime: { $gte: windowStart, $lte: windowEnd },
  };

  if (excludeElectionId) {
    filter._id = { $ne: excludeElectionId };
  }

  const existingElection = await Election.findOne(filter)
    .sort({ startTime: -1 })
    .select("_id title startTime")
    .lean();

  if (!existingElection) {
    return null;
  }

  return `Free plan schools can only run one election every ${FREE_PLAN_ELECTION_INTERVAL_MONTHS} months. Last conflicting election: ${existingElection.title || existingElection._id} (${existingElection.startTime?.toISOString?.() || "unknown startDate"}).`;
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

    const pagination = getPagination(req.query);
    const filter = {
      schoolId: req.schoolId,
      status,
    };
    const query = Election.find(filter).sort({ startTime: -1, createdAt: -1 });

    if (pagination.enabled) {
      query.skip(pagination.skip).limit(pagination.limit);
    }

    const [elections, total] = await Promise.all([
      query,
      pagination.enabled ? Election.countDocuments(filter) : Promise.resolve(null),
    ]);

    if (pagination.enabled) {
      return res.status(200).json({
        items: elections.map(mapElectionResponse),
        pagination: buildPaginationMeta({ ...pagination, total }),
      });
    }

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

    const audienceQuery = buildAudienceStudentQuery(election);
    const [aspirants, eligibleStudentCount] = await Promise.all([
      Aspirant.find({ electionId: election._id, schoolId: req.schoolId })
        .sort({ electoralCategory: 1, name: 1 })
        .select("name studentId programmeOfStudy level faculty electoralCategory imageUrl"),
      audienceQuery ? Student.countDocuments(audienceQuery) : Promise.resolve(0),
    ]);

    return res.status(200).json({
      _id: election._id.toString(),
      title: election.title,
      status: parseStatus(election.status),
      startDate: election.startTime ? election.startTime.toISOString() : null,
      endDate: election.endTime ? election.endTime.toISOString() : null,
      categories: (election.categories || []).map((category) => category.title),
      audience: normalizeElectionAudience(election.audience),
      eligibleStudentCount,
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
    }).select("schoolId subTitle categories votes audience");

    if (!election) {
      return sendError(res, 404, "Election not found");
    }

    const isInVotersList = await isStudentRegistryIdInElectionVoters({
      election,
      schoolId: req.schoolId,
      studentRegistryId: req.ecUser?.studentId,
      student: req.ecUser,
    });

    const votes = await getStoredVotesForElection(election);
    let categories = (election.categories || []).map((category) =>
      mapAdminCategoryResponse({
        election,
        category,
        ecUserId: req.ecUser?._id,
        isInVotersList,
        votes,
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
              ecUserId: req.ecUser?._id,
              isInVotersList,
              votes,
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
    }).select("_id schoolId audience votes");

    if (!election) {
      return sendError(res, 404, "Election not found");
    }
    const isInVotersList = await isStudentRegistryIdInElectionVoters({
      election,
      schoolId: req.schoolId,
      studentRegistryId: req.ecUser?.studentId,
      student: req.ecUser,
    });

    const filter = {
      electionId,
      schoolId: req.schoolId,
    };

    if (categoryId) {
      filter.$or = [{ categoryId }, { electoralCategory: categoryId }];
    }

    const pagination = getPagination(req.query);
    const aspirantsQuery = Aspirant.find(filter)
      .sort({ electoralCategory: 1, name: 1 })
      .select(
        "name studentId programmeOfStudy level faculty electoralCategory imageUrl electionId categoryId voteCount"
      );

    if (pagination.enabled) {
      aspirantsQuery.skip(pagination.skip).limit(pagination.limit);
    }

    const [aspirants, total] = await Promise.all([
      aspirantsQuery,
      pagination.enabled ? Aspirant.countDocuments(filter) : Promise.resolve(null),
    ]);
    const votes = await getStoredVotesForElection(election);

    const items = aspirants.map((aspirant) => ({
        ...mapEditAspirantResponse(aspirant),
        hasVotedInCategory: hasEcVoteInCategory({
          votes,
          ecUserId: req.ecUser?._id,
          categoryId: aspirant.categoryId?.toString() || aspirant.electoralCategory,
        }),
        isInVotersList,
      }));

    if (pagination.enabled) {
      return res.status(200).json({
        items,
        pagination: buildPaginationMeta({ ...pagination, total }),
      });
    }

    return res.status(200).json(items);
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
      categories = [],
      status,
      aspirants = [],
      aspirantListUrl = "",
      audience,
      audienceScope,
      faculties,
      nationalities,
    } = req.body;

    if (req.body.voters != null || req.body.voterListUrl != null) {
      return sendError(
        res,
        400,
        "EC voter-list uploads have been retired. Use audience filters against imported school students."
      );
    }

    if (!title || !status) {
      return sendError(res, 400, "title and status are required");
    }

    const normalizedStatus = parseStatus(status);
    if (!["draft", "scheduled"].includes(normalizedStatus)) {
      return sendError(res, 400, "status must be draft or scheduled");
    }
    const normalizedAudience = resolveElectionAudience({
      audience,
      audienceScope,
      faculties,
      nationalities,
    });
    const audienceError = validateEcElectionAudience(normalizedAudience);
    if (audienceError) {
      return sendError(res, 400, audienceError);
    }

    const normalizedCategoryTitles = (categories || []).map((category) => String(category).trim());
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

    const aspirantsMissingImages = await findAspirantsMissingImages({ aspirants, req });
    if (aspirantsMissingImages.length > 0) {
      return sendError(
        res,
        400,
        "Each aspirant must have a photo before creating an election",
        { aspirants: aspirantsMissingImages }
      );
    }
    const aspirantImageOwnershipError = await validateAspirantImageOwnership({
      aspirants,
      req,
    });
    if (aspirantImageOwnershipError) {
      return sendError(
        res,
        400,
        aspirantImageOwnershipError.error,
        aspirantImageOwnershipError.details
      );
    }

    if (normalizedStatus === "scheduled") {
      if (!startDate || !endDate || !Array.isArray(categories) || categories.length === 0) {
        return sendError(
          res,
          400,
          "title, startDate, endDate, categories, and status are required for scheduled elections"
        );
      }
    }

    const normalizedElectionImageUrl = await resolveElectionImageUrl({ imageUrl, req });
    if (imageUrl && !normalizedElectionImageUrl) {
      return sendError(
        res,
        400,
        "Election image must be uploaded for this election and use the returned image URL"
      );
    }
    const electionImageOwnershipError = await validateElectionImageOwnership({
      imageUrl: normalizedElectionImageUrl,
      req,
    });
    if (electionImageOwnershipError) {
      return sendError(
        res,
        400,
        electionImageOwnershipError.error,
        electionImageOwnershipError.details
      );
    }

    let start = null;
    let end = null;
    let school = await School.findById(req.schoolId).select("shortName subscriptionExpiresAt");

    if (normalizedStatus === "scheduled") {
      start = new Date(startDate);
      end = new Date(endDate);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return sendError(res, 400, "startDate and endDate must be valid ISO datetimes");
      }

      const schoolEligibility = await validateElectionStartEligibility(req.schoolId);
      if (schoolEligibility.error) {
        return sendError(res, 403, schoolEligibility.error);
      }

      school =
        schoolEligibility.school ||
        school ||
        (await School.findById(req.schoolId).select("shortName subscriptionExpiresAt"));
      const dateError = validateElectionWindow({ start, end, school });
      if (dateError) {
        return sendError(res, 400, dateError);
      }

      const cadenceError = await validateFreePlanElectionCadence({
        school,
        schoolId: req.schoolId,
        start,
      });
      if (cadenceError) {
        return sendError(res, 400, cadenceError);
      }
    }

    const election = await Election.create({
      schoolId: req.schoolId,
      title,
      imageUrl: normalizedElectionImageUrl,
      startTime: start,
      endTime: end,
      categories: normalizeCategories(normalizedCategoryTitles.filter(Boolean)),
      audience: normalizedAudience,
      candidates: aspirants
        .map((aspirant) => ({
          name: String(aspirant.name || "").trim(),
          position: String(aspirant.electoralCategory || "").trim(),
        }))
        .filter((aspirant) => aspirant.name && aspirant.position),
      status: normalizedStatus,
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

    await recordActivity({
      actorType: EC_ROLE,
      actorId: req.ecUser._id,
      schoolId: req.schoolId,
      action: "Election Created",
      metadata: {
        electionId: election._id,
        status: election.status,
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
      await emitStudentScopedEvent({
        eventName: "student:election:scheduled",
        studentIds: await getEligibleStudentObjectIdsForElection(election),
        payload: buildStudentHomeElectionEventPayload(election, "scheduled"),
      });
      await emitAdminSchoolEvent({
        eventName: "ec:election:scheduled",
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
      aspirants,
      aspirantListUrl,
      audience,
      audienceScope,
      faculties,
      nationalities,
    } = req.body;

    if (
      req.body.voters != null ||
      req.body.voterListUrl != null ||
      req.body.keepExistingVoters != null
    ) {
      return sendError(
        res,
        400,
        "EC voter-list uploads have been retired. Use audience filters against imported school students."
      );
    }

    if (title != null) election.title = title;
    if (imageUrl != null) {
      const normalizedElectionImageUrl = await resolveElectionImageUrl({ imageUrl, req });
      if (imageUrl && !normalizedElectionImageUrl) {
        return sendError(
          res,
          400,
          "Election image must be uploaded for this election and use the returned image URL"
        );
      }
      const electionImageOwnershipError = await validateElectionImageOwnership({
        imageUrl: normalizedElectionImageUrl,
        req,
        electionId: election._id,
      });
      if (electionImageOwnershipError) {
        return sendError(
          res,
          400,
          electionImageOwnershipError.error,
          electionImageOwnershipError.details
        );
      }
      election.imageUrl = normalizedElectionImageUrl;
    }
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
    if (
      audience !== undefined ||
      audienceScope !== undefined ||
      faculties !== undefined ||
      nationalities !== undefined
    ) {
      const normalizedAudience = resolveElectionAudience({
        audience,
        audienceScope,
        faculties,
        nationalities,
      });
      const audienceError = validateEcElectionAudience(normalizedAudience);
      if (audienceError) {
        return sendError(res, 400, audienceError);
      }
      election.audience = normalizedAudience;
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

      const aspirantsMissingImages = await findAspirantsMissingImages({ aspirants, req });
      if (aspirantsMissingImages.length > 0) {
        return sendError(
          res,
          400,
          "Each aspirant must have a photo before updating election aspirants",
          { aspirants: aspirantsMissingImages }
        );
      }
      const aspirantImageOwnershipError = await validateAspirantImageOwnership({
        aspirants,
        req,
        electionId: election._id,
      });
      if (aspirantImageOwnershipError) {
        return sendError(
          res,
          400,
          aspirantImageOwnershipError.error,
          aspirantImageOwnershipError.details
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

    const cadenceError = await validateFreePlanElectionCadence({
      school: schoolEligibility.school,
      schoolId: req.schoolId,
      start: new Date(election.startTime),
      excludeElectionId: election._id,
    });
    if (cadenceError) {
      return sendError(res, 400, cadenceError);
    }

    await election.save();

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
      actorType: EC_ROLE,
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
      await emitStudentScopedEvent({
        eventName: "student:election:scheduled",
        studentIds: await getEligibleStudentObjectIdsForElection(election),
        payload: buildStudentHomeElectionEventPayload(election, "scheduled"),
      });
      await emitAdminSchoolEvent({
        eventName: "ec:election:scheduled",
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

    const cadenceError = await validateFreePlanElectionCadence({
      school: schoolEligibility.school,
      schoolId: req.schoolId,
      start: new Date(election.startTime),
      excludeElectionId: election._id,
    });
    if (cadenceError) {
      return sendError(res, 400, cadenceError);
    }

    election.status = "scheduled";
    await election.save();
    await recordActivity({
      actorType: EC_ROLE,
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
    await emitStudentScopedEvent({
      eventName: "student:election:scheduled",
      studentIds: await getEligibleStudentObjectIdsForElection(election),
      payload: buildStudentHomeElectionEventPayload(election, "scheduled"),
    });
    await emitAdminSchoolEvent({
      eventName: "ec:election:scheduled",
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

    if (["active", "closed"].includes(parseStatus(election.status))) {
      return sendError(res, 403, "Active or closed elections cannot be deleted");
    }

    const eligibleStudentIds = await getEligibleStudentObjectIdsForElection(election);
    const deletedPayload = buildStudentHomeElectionEventPayload(election, "deleted");

    await Aspirant.deleteMany({ electionId: election._id });
    await Election.deleteOne({ _id: election._id });
    await recordActivity({
      actorType: EC_ROLE,
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
    await emitStudentScopedEvent({
      eventName: "election:deleted",
      studentIds: eligibleStudentIds,
      payload: deletedPayload,
    });
    await emitAdminSchoolEvent({
      eventName: "ec:election:deleted",
      schoolId: election.schoolId,
      payload: buildAdminHomeElectionEventPayload(election, "deleted"),
    });
    return res.status(200).json({});
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to delete election");
  }
};
