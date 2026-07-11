import mongoose from "mongoose";
import School from "../models/school.js";
import SchoolAdmin from "../models/SchoolAdmin.js";
import SchoolLogoUpload from "../models/SchoolLogoUpload.js";
import { sendError } from "../utils/apiResponse.js";
import {
  isValidEmailDomain,
  normalizeAllowedEmailDomains,
} from "../utils/emailDomains.js";
import { resolveLogoUrl } from "../utils/logoUrl.js";
import {
  isStrongPassword,
  isValidEmail,
  normalizeEmail,
  strongPasswordMessage,
} from "../utils/security.js";
import { isSchoolRegistrationReviewRequest } from "../middleware/authSchoolRegistrationReview.js";
import { resolveSuperAdminFromRequest } from "../middleware/authSuperAdmin.js";
export { promoteSchoolAdmins } from "./authController.js";
import {
  calculateSubscriptionExpiry,
  getPlanConfig,
  getSubscriptionTermConfig,
  subscriptionTerms,
  syncSchoolSubscriptionState,
} from "../utils/plans.js";
import {
  deleteOfficialSchoolDocument,
  encryptAndUploadOfficialSchoolDocument,
} from "../utils/officialSchoolDocuments.js";

const isSupportedSubscriptionTerm = (term) =>
  Boolean(subscriptionTerms[String(term || "").trim()]);

export const createSchool = async (req, res) => {
  const {
    name,
    fullName,
    shortName,
    logoUploadId,
    email,
    allowedEmailDomains,
    plan,
    subscriptionTerm,
    admin,
    faculties = [],
  } = req.body;

  let school = null;
  let schoolAdmin = null;
  const uploadedStoragePaths = [];

  try {
    const effectivePlan = plan || "free";
    const effectiveTerm = subscriptionTerm || "4_months";
    if (!isSupportedSubscriptionTerm(effectiveTerm)) {
      return sendError(res, 400, "subscriptionTerm must be one_off_election, 4_months, or 1_year");
    }

    const subscriptionStartedAt = new Date();
    const subscriptionExpiresAt = calculateSubscriptionExpiry({
      subscriptionTerm: effectiveTerm,
      startedAt: subscriptionStartedAt,
    });
    const selectedPlan = getPlanConfig(effectivePlan);
    const selectedTerm = getSubscriptionTermConfig(effectiveTerm);
    const normalizedAdminEmail = normalizeEmail(admin?.email);
    const normalizedAllowedDomains = normalizeAllowedEmailDomains(allowedEmailDomains);
    const superAdmin = await resolveSuperAdminFromRequest(req);
    const isDeveloperOnboarding =
      Boolean(superAdmin) || isSchoolRegistrationReviewRequest(req);
    const registrationStatus = isDeveloperOnboarding ? "approved" : "pending";
    const subscriptionActive = isDeveloperOnboarding;
    const registrationReviewedAt = isDeveloperOnboarding ? new Date() : undefined;
    const registrationReviewedBy = isDeveloperOnboarding
      ? String(
          req.schoolRegistrationReviewer ||
            req.headers["x-reviewer-name"] ||
            "developer-onboarding"
        )
          .trim()
          .slice(0, 120)
      : undefined;

    if (!admin) {
      return sendError(res, 400, "The first school admin account is required");
    }

    if (
      !isDeveloperOnboarding &&
      (!Array.isArray(req.files) || req.files.length === 0)
    ) {
      return sendError(
        res,
        400,
        "At least one official school document is required for registration review"
      );
    }

    if (!isValidEmail(email)) {
      return sendError(res, 400, "email must be a valid email address");
    }

    if (req.body?.logoUrl != null) {
      return sendError(res, 400, "logoUrl is no longer accepted. Upload a logo first and send logoUploadId.");
    }

    let logoUrl = "";
    let logoUpload = null;
    if (logoUploadId) {
      logoUpload = await SchoolLogoUpload.findOne({
        uploadId: String(logoUploadId).trim(),
        consumedAt: null,
      });

      if (!logoUpload) {
        return sendError(res, 400, "Invalid or expired logoUploadId");
      }

      logoUrl = logoUpload.url;
    }

    if (normalizedAllowedDomains.length === 0) {
      return sendError(res, 400, "allowedEmailDomains must include at least one email domain");
    }

    const invalidDomain = normalizedAllowedDomains.find(
      (domain) => !isValidEmailDomain(domain)
    );
    if (invalidDomain) {
      return sendError(res, 400, `Invalid allowed email domain: ${invalidDomain}`);
    }

    if (admin) {
      if (
        !admin.firstName ||
        !admin.lastName ||
        !isValidEmail(normalizedAdminEmail) ||
        !admin.password
      ) {
        return sendError(
          res,
          400,
          "admin.firstName, admin.lastName, a valid admin.email, and admin.password are required"
        );
      }

      if (!isStrongPassword(admin.password)) {
        return sendError(res, 400, strongPasswordMessage);
      }

      const existingSchoolAdmin = await SchoolAdmin.findOne({
        email: normalizedAdminEmail,
      }).select("_id");
      if (existingSchoolAdmin) {
        return sendError(res, 409, "School admin email already exists");
      }
    }

    school = await School.create({
      name,
      fullName: fullName || name,
      shortName: shortName || "",
      logoUrl: logoUrl || "",
      email,
      allowedEmailDomains: normalizedAllowedDomains,
      plan: effectivePlan,
      subscriptionTerm: effectiveTerm,
      subscriptionStartedAt,
      subscriptionExpiresAt,
      subscriptionActive,
      registrationStatus,
      registrationSubmittedAt: new Date(),
      registrationReviewedAt,
      registrationReviewedBy,
      faculties,
    });
    if (admin) {
      try {
        schoolAdmin = await SchoolAdmin.create({
          schoolId: school._id,
          firstName: String(admin.firstName).trim(),
          lastName: String(admin.lastName).trim(),
          email: normalizedAdminEmail,
          password: admin.password,
          isActive: isDeveloperOnboarding,
        });
      } catch (error) {
        if (error.code === 11000) {
          await School.deleteOne({ _id: school._id });
          const duplicateSchoolId = Boolean(error.keyPattern?.schoolId);
          return sendError(
            res,
            409,
            duplicateSchoolId
              ? "This school already has a school admin"
              : "School admin email already exists"
          );
        }
        throw error;
      }
    }

    const officialDocuments = await Promise.all(
      (req.files || []).map(async (file) => {
        const documentId = new mongoose.Types.ObjectId();
        const document = await encryptAndUploadOfficialSchoolDocument({
          schoolId: school._id.toString(),
          documentId: documentId.toString(),
          file,
        });
        uploadedStoragePaths.push(document.storagePath);
        return {
          _id: documentId,
          ...document,
        };
      })
    );
    school.officialDocuments.push(...officialDocuments);
    if ((req.files || []).length > 0) {
      await school.save();
    }
    if (logoUpload) {
      logoUpload.consumedAt = new Date();
      await logoUpload.save();
    }

    res.status(201).json({
      message: isDeveloperOnboarding
        ? "School created by developer onboarding"
        : "School registration submitted for review",
      schoolId: school._id,
      logoUrl: resolveLogoUrl(req, school.logoUrl),
      registrationStatus: school.registrationStatus,
      allowedEmailDomains: school.allowedEmailDomains,
      officialDocumentCount: school.officialDocuments.length,
      schoolAdmin: schoolAdmin
        ? {
            _id: schoolAdmin._id.toString(),
            firstName: schoolAdmin.firstName,
            lastName: schoolAdmin.lastName,
            email: schoolAdmin.email,
            role: schoolAdmin.role,
          }
        : null,
      subscription: {
        planName: selectedPlan.name,
        studentRange: selectedPlan.studentRange,
        voteLimit: selectedPlan.maxVoters,
        subscriptionTerm: effectiveTerm,
        subscriptionTermLabel: selectedTerm.label,
        startedAt: subscriptionStartedAt.toISOString(),
        expiryDate: subscriptionExpiresAt?.toISOString() || null,
        isActive: subscriptionActive,
      },
    });
  } catch (err) {
    await Promise.all(
      uploadedStoragePaths.map((storagePath) =>
        deleteOfficialSchoolDocument(storagePath).catch(() => null)
      )
    );
    if (schoolAdmin?._id) {
      await SchoolAdmin.deleteOne({ _id: schoolAdmin._id }).catch(() => null);
    }
    if (school?._id) {
      await School.deleteOne({ _id: school._id }).catch(() => null);
    }

    const isDocumentError =
      /document|image|dimension|pixel|format|encryption key/i.test(
        err.message || ""
      );
    return sendError(
      res,
      isDocumentError ? 400 : 500,
      isDocumentError ? err.message : err.message || "Failed to create school"
    );
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

    if (req.schoolAdmin?.schoolId?.toString() !== schoolId) {
      return sendError(res, 403, "You are not allowed to update this school");
    }

    const startedAt = subscriptionStartedAt
      ? new Date(subscriptionStartedAt)
      : new Date();

    if (Number.isNaN(startedAt.getTime())) {
      return sendError(res, 400, "subscriptionStartedAt must be a valid ISO datetime");
    }

    school.plan = plan || school.plan;
    if (subscriptionTerm && !isSupportedSubscriptionTerm(subscriptionTerm)) {
      return sendError(res, 400, "subscriptionTerm must be one_off_election, 4_months, or 1_year");
    }
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
    const schools = await School.find({
      $or: [
        { registrationStatus: "approved" },
        { registrationStatus: { $exists: false } },
      ],
    }).select(
      "fullName shortName logoUrl name allowedEmailDomains"
    );

    return res.status(200).json(
      schools.map((school) => ({
        id: school._id.toString(),
        fullName: school.fullName || school.name,
        shortName: school.shortName || "",
        logoUrl: resolveLogoUrl(req, school.logoUrl),
        allowedEmailDomains: school.allowedEmailDomains || [],
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load schools");
  }
};

export const getFacultiesBySchool = async (req, res) => {
  try {
    const school = await School.findOne({
      _id: req.params.schoolId,
      $or: [
        { registrationStatus: "approved" },
        { registrationStatus: { $exists: false } },
      ],
    }).select("faculties");

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
    const school = await School.findOne({
      _id: req.params.schoolId,
      $or: [
        { registrationStatus: "approved" },
        { registrationStatus: { $exists: false } },
      ],
    }).select("faculties");

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
