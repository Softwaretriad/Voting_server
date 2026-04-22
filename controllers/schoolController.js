import School from "../models/school.js";
import { sendError } from "../utils/apiResponse.js";
import { resolveLogoUrl } from "../utils/logoUrl.js";
import {
  calculateSubscriptionExpiry,
  getPlanConfig,
  getSubscriptionTermConfig,
  syncSchoolSubscriptionState,
} from "../utils/plans.js";

export const createSchool = async (req, res) => {
  const {
    name,
    fullName,
    shortName,
    logoUrl,
    email,
    plan,
    subscriptionTerm,
    faculties = [],
  } = req.body;

  try {
    const effectivePlan = plan || "free";
    const effectiveTerm = subscriptionTerm || "1_month";
    const subscriptionStartedAt = new Date();
    const subscriptionExpiresAt = calculateSubscriptionExpiry({
      subscriptionTerm: effectiveTerm,
      startedAt: subscriptionStartedAt,
    });
    const selectedPlan = getPlanConfig(effectivePlan);
    const selectedTerm = getSubscriptionTermConfig(effectiveTerm);

    const school = await School.create({
      name,
      fullName: fullName || name,
      shortName: shortName || "",
      logoUrl: logoUrl || "",
      email,
      plan: effectivePlan,
      subscriptionTerm: effectiveTerm,
      subscriptionStartedAt,
      subscriptionExpiresAt,
      subscriptionActive: true,
      faculties,
    });

    res.status(201).json({
      message: "School created",
      schoolId: school._id,
      subscription: {
        planName: selectedPlan.name,
        studentRange: selectedPlan.studentRange,
        voteLimit: selectedPlan.maxVoters,
        subscriptionTerm: effectiveTerm,
        subscriptionTermLabel: selectedTerm.label,
        startedAt: subscriptionStartedAt.toISOString(),
        expiryDate: subscriptionExpiresAt?.toISOString() || null,
        isActive: true,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const checkSubscription = async (req, res) => {
  const { schoolId } = req.params;

  try {
    const school = await School.findById(schoolId);
    if (!school) return res.status(404).json({ error: "School not found" });
    syncSchoolSubscriptionState(school);
    const selectedPlan = getPlanConfig(school.plan);
    const selectedTerm = getSubscriptionTermConfig(school.subscriptionTerm);

    res.json({
      subscriptionActive: school.subscriptionActive,
      plan: school.plan,
      planName: selectedPlan.name,
      studentRange: selectedPlan.studentRange,
      voteLimit: selectedPlan.maxVoters,
      subscriptionTerm: school.subscriptionTerm,
      subscriptionTermLabel: selectedTerm.label,
      subscriptionStartedAt: school.subscriptionStartedAt?.toISOString() || null,
      expiryDate: school.subscriptionExpiresAt?.toISOString() || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateSchoolSubscription = async (req, res) => {
  const { schoolId } = req.params;
  const { plan, subscriptionTerm, subscriptionStartedAt } = req.body || {};

  try {
    const school = await School.findById(schoolId);
    if (!school) {
      return sendError(res, 404, "School not found");
    }

    if (req.schoolId?.toString() !== schoolId) {
      return sendError(res, 403, "You are not allowed to update this school");
    }

    const startedAt = subscriptionStartedAt
      ? new Date(subscriptionStartedAt)
      : new Date();

    if (Number.isNaN(startedAt.getTime())) {
      return sendError(res, 400, "subscriptionStartedAt must be a valid ISO datetime");
    }

    school.plan = plan || school.plan;
    school.subscriptionTerm = subscriptionTerm || school.subscriptionTerm;
    school.subscriptionStartedAt = startedAt;
    school.subscriptionExpiresAt = calculateSubscriptionExpiry({
      subscriptionTerm: school.subscriptionTerm,
      startedAt,
    });
    school.subscriptionActive = true;
    school.oneOffElectionConsumed = false;
    await school.save();

    const selectedPlan = getPlanConfig(school.plan);
    const selectedTerm = getSubscriptionTermConfig(school.subscriptionTerm);

    return res.status(200).json({
      schoolId: school._id.toString(),
      subscription: {
        plan: school.plan,
        planName: selectedPlan.name,
        studentRange: selectedPlan.studentRange,
        voteLimit: selectedPlan.maxVoters,
        subscriptionTerm: school.subscriptionTerm,
        subscriptionTermLabel: selectedTerm.label,
        startedAt: school.subscriptionStartedAt.toISOString(),
        expiryDate: school.subscriptionExpiresAt?.toISOString() || null,
        isActive: school.subscriptionActive,
      },
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to update subscription");
  }
};

export const getAllSchools = async (req, res) => {
  try {
    const schools = await School.find({}).select("fullName shortName logoUrl name");

    return res.status(200).json(
      schools.map((school) => ({
        id: school._id.toString(),
        fullName: school.fullName || school.name,
        shortName: school.shortName || "",
        logoUrl: resolveLogoUrl(req, school.logoUrl),
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load schools");
  }
};

export const getFacultiesBySchool = async (req, res) => {
  try {
    const school = await School.findById(req.params.schoolId).select("faculties");

    if (!school) {
      return sendError(res, 404, "School not found");
    }

    return res.status(200).json(
      school.faculties.map((faculty) => ({
        id: faculty._id.toString(),
        name: faculty.name,
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load faculties");
  }
};

export const getProgrammesByFaculty = async (req, res) => {
  try {
    const school = await School.findById(req.params.schoolId).select("faculties");

    if (!school) {
      return sendError(res, 404, "School not found");
    }

    const faculty = school.faculties.id(req.params.facultyId);
    if (!faculty) {
      return sendError(res, 404, "Faculty not found");
    }

    return res.status(200).json(
      faculty.programmes.map((programme) => ({
        id: programme._id.toString(),
        name: programme.name,
        durationYears: programme.durationYears ?? 4,
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load programmes");
  }
};
