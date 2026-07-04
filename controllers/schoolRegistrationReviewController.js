import mongoose from "mongoose";
import School from "../models/school.js";
import SchoolAdmin from "../models/SchoolAdmin.js";
import { sendError } from "../utils/apiResponse.js";
import { downloadAndDecryptOfficialSchoolDocument } from "../utils/officialSchoolDocuments.js";
import { calculateSubscriptionExpiry } from "../utils/plans.js";

const documentMetadata = (document) => ({
  id: document._id.toString(),
  originalName: document.originalName,
  mimeType: document.mimeType,
  size: document.size,
  sha256: document.sha256,
  uploadedAt: document.uploadedAt,
});

export const listSchoolRegistrationApplications = async (req, res) => {
  try {
    const requestedStatus = String(req.query.status || "pending").trim();
    const allowedStatuses = new Set(["pending", "approved", "rejected"]);
    if (!allowedStatuses.has(requestedStatus)) {
      return sendError(res, 400, "status must be pending, approved, or rejected");
    }

    const schools = await School.find({ registrationStatus: requestedStatus })
      .select(
        "name fullName shortName email allowedEmailDomains plan subscriptionTerm registrationStatus registrationSubmittedAt registrationReviewedAt registrationReviewedBy registrationRejectionReason officialDocuments"
      )
      .sort({ registrationSubmittedAt: 1 })
      .lean();
    const schoolIds = schools.map((school) => school._id);
    const admins = await SchoolAdmin.find({ schoolId: { $in: schoolIds } })
      .select("schoolId firstName lastName email isActive createdAt")
      .lean();
    const adminsBySchool = new Map(
      admins.map((admin) => [admin.schoolId.toString(), admin])
    );

    return res.status(200).json(
      schools.map((school) => {
        const admin = adminsBySchool.get(school._id.toString());
        return {
          schoolId: school._id.toString(),
          name: school.name,
          fullName: school.fullName || school.name,
          shortName: school.shortName || "",
          email: school.email,
          allowedEmailDomains: school.allowedEmailDomains,
          plan: school.plan,
          subscriptionTerm: school.subscriptionTerm,
          registrationStatus: school.registrationStatus,
          submittedAt: school.registrationSubmittedAt,
          reviewedAt: school.registrationReviewedAt,
          reviewedBy: school.registrationReviewedBy,
          rejectionReason: school.registrationRejectionReason,
          schoolAdmin: admin
            ? {
                firstName: admin.firstName,
                lastName: admin.lastName,
                email: admin.email,
                isActive: admin.isActive,
              }
            : null,
          officialDocuments: school.officialDocuments.map(documentMetadata),
        };
      })
    );
  } catch (error) {
    return sendError(res, 500, "Failed to load school registration applications");
  }
};

export const downloadSchoolRegistrationDocument = async (req, res) => {
  try {
    const { schoolId, documentId } = req.params;
    if (
      !mongoose.isValidObjectId(schoolId) ||
      !mongoose.isValidObjectId(documentId)
    ) {
      return sendError(res, 400, "Invalid school or document id");
    }

    const school = await School.findById(schoolId).select("officialDocuments");
    if (!school) {
      return sendError(res, 404, "School registration not found");
    }

    const document = school.officialDocuments.id(documentId);
    if (!document) {
      return sendError(res, 404, "Official document not found");
    }

    const buffer = await downloadAndDecryptOfficialSchoolDocument({
      schoolId,
      document,
    });
    const safeName = document.originalName.replace(/["\r\n]/g, "_");
    res.setHeader("Content-Type", document.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("Content-Length", String(buffer.length));
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("School registration document decrypt failed:", error.message);
    return sendError(res, 500, "Unable to decrypt official document");
  }
};

export const approveSchoolRegistration = async (req, res) => {
  try {
    const school = await School.findOne({
      _id: req.params.schoolId,
      registrationStatus: "pending",
    });
    if (!school) {
      return sendError(res, 404, "Pending school registration not found");
    }

    const schoolAdmin = await SchoolAdmin.findOne({ schoolId: school._id });
    if (!schoolAdmin) {
      return sendError(res, 409, "School registration has no school admin");
    }

    const reviewedAt = new Date();
    school.registrationStatus = "approved";
    school.registrationReviewedAt = reviewedAt;
    school.registrationReviewedBy = req.schoolRegistrationReviewer;
    school.registrationRejectionReason = "";
    school.subscriptionActive = true;
    school.subscriptionStartedAt = reviewedAt;
    school.subscriptionExpiresAt = calculateSubscriptionExpiry({
      subscriptionTerm: school.subscriptionTerm,
      startedAt: reviewedAt,
    });
    await school.save();

    try {
      schoolAdmin.isActive = true;
      schoolAdmin.sessionVersion = Number(schoolAdmin.sessionVersion || 0) + 1;
      await schoolAdmin.save();
    } catch (error) {
      school.registrationStatus = "pending";
      school.registrationReviewedAt = null;
      school.registrationReviewedBy = "";
      school.subscriptionActive = false;
      await school.save().catch(() => null);
      throw error;
    }

    return res.status(200).json({
      message: "School registration approved",
      schoolId: school._id.toString(),
      registrationStatus: school.registrationStatus,
      schoolAdminActive: schoolAdmin.isActive,
      reviewedAt,
    });
  } catch (error) {
    if (error instanceof mongoose.Error.CastError) {
      return sendError(res, 400, "Invalid school id");
    }
    return sendError(res, 500, "Failed to approve school registration");
  }
};

export const rejectSchoolRegistration = async (req, res) => {
  try {
    const reason = String(req.body?.reason || "").trim();
    if (reason.length < 10 || reason.length > 1000) {
      return sendError(res, 400, "reason must be between 10 and 1000 characters");
    }

    const school = await School.findOne({
      _id: req.params.schoolId,
      registrationStatus: "pending",
    });
    if (!school) {
      return sendError(res, 404, "Pending school registration not found");
    }

    const reviewedAt = new Date();
    school.registrationStatus = "rejected";
    school.registrationReviewedAt = reviewedAt;
    school.registrationReviewedBy = req.schoolRegistrationReviewer;
    school.registrationRejectionReason = reason;
    school.subscriptionActive = false;
    await school.save();

    await SchoolAdmin.updateOne(
      { schoolId: school._id },
      {
        $set: { isActive: false, refreshToken: null },
        $inc: { sessionVersion: 1 },
      }
    );

    return res.status(200).json({
      message: "School registration rejected",
      schoolId: school._id.toString(),
      registrationStatus: school.registrationStatus,
      reviewedAt,
    });
  } catch (error) {
    if (error instanceof mongoose.Error.CastError) {
      return sendError(res, 400, "Invalid school id");
    }
    return sendError(res, 500, "Failed to reject school registration");
  }
};
