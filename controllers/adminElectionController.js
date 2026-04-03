import Election from "../models/Election.js";
import School from "../models/school.js";
import { sendError } from "../utils/apiResponse.js";
import { recordActivity } from "../utils/activityLog.js";

const allowedStatuses = new Set(["active", "scheduled", "draft", "closed"]);

const mapElectionResponse = (election) => ({
  _id: election._id.toString(),
  title: election.title,
  status: election.status === "pending" ? "draft" : election.status,
  startDate: election.startTime ? election.startTime.toISOString() : null,
  endDate: election.endTime ? election.endTime.toISOString() : null,
  categories: (election.categories || []).map((category) => category.title),
  voterListUrl: election.voterListUrl || "",
  aspirantListUrl: election.aspirantListUrl || "",
});

const normalizeCategories = (categories = []) =>
  categories.map((category) => ({
    title: String(category).trim(),
    subTitle: "",
    imageUrl: "",
  }));

const parseStatus = (status) => (status === "pending" ? "draft" : status);

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

export const createAdminElection = async (req, res) => {
  try {
    const {
      title,
      startDate,
      endDate,
      categories,
      status,
      voterListUrl = "",
      aspirantListUrl = "",
    } = req.body;

    if (!title || !startDate || !endDate || !Array.isArray(categories) || categories.length === 0 || !status) {
      return sendError(res, 400, "title, startDate, endDate, categories, and status are required");
    }

    const normalizedStatus = parseStatus(status);
    if (!["draft", "scheduled"].includes(normalizedStatus)) {
      return sendError(res, 400, "status must be draft or scheduled");
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return sendError(res, 400, "startDate and endDate must be valid ISO datetimes and endDate must be after startDate");
    }

    if (normalizedStatus === "scheduled" && start < new Date()) {
      return sendError(res, 400, "Scheduled elections must start in the future");
    }

    const school = await School.findById(req.schoolId).select("shortName");

    const election = await Election.create({
      schoolId: req.schoolId,
      title,
      startTime: start,
      endTime: end,
      categories: normalizeCategories(categories),
      status: normalizedStatus,
      voterListUrl,
      aspirantListUrl,
      subTitle: school?.shortName || "",
    });

    await recordActivity({
      actorType: "admin",
      actorId: req.ecUser._id,
      schoolId: req.schoolId,
      action: "Election Created",
      metadata: { electionId: election._id, status: election.status },
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
    if (status != null) {
      const normalizedStatus = parseStatus(status);
      if (!["draft", "scheduled"].includes(normalizedStatus)) {
        return sendError(res, 400, "Only draft and scheduled elections can be updated through this route");
      }
      election.status = normalizedStatus;
    }
    if (voterListUrl != null) election.voterListUrl = voterListUrl;
    if (aspirantListUrl != null) election.aspirantListUrl = aspirantListUrl;

    if (
      election.startTime &&
      election.endTime &&
      new Date(election.endTime) <= new Date(election.startTime)
    ) {
      return sendError(res, 400, "endDate must be after startDate");
    }

    if (election.status === "scheduled" && election.startTime < new Date()) {
      return sendError(res, 400, "Scheduled elections must start in the future");
    }

    await election.save();
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

    if (!election.startTime || election.startTime < new Date()) {
      return sendError(res, 400, "Election startDate must be in the future before scheduling");
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

    if (parseStatus(election.status) !== "draft") {
      return sendError(res, 403, "Only draft elections can be deleted");
    }

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
