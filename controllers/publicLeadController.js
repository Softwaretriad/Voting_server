import PublicLeadRequest from "../models/PublicLeadRequest.js";
import { sendError } from "../utils/apiResponse.js";
import { isValidEmail, normalizeEmail } from "../utils/security.js";

const ensureMinLength = (value, min) => String(value || "").trim().length >= min;

export const createDemoRequest = async (req, res) => {
  try {
    const {
      institutionName,
      institutionType = "other",
      fullName,
      positionRole,
      emailAddress,
      phoneNumber,
      estimatedStudentPopulation,
      expectedElectionPeriod,
      conductedDigitalElectionsBefore,
      additionalInformation,
      preferredMeetingDate,
      preferredMeetingTime,
    } = req.body || {};

    if (!institutionName || !fullName || !isValidEmail(emailAddress)) {
      return sendError(
        res,
        400,
        "institutionName, fullName, and a valid emailAddress are required"
      );
    }

    const request = await PublicLeadRequest.create({
      type: "demo",
      institutionName,
      institutionType,
      fullName,
      positionRole,
      email: normalizeEmail(emailAddress),
      phoneNumber,
      estimatedStudentPopulation,
      expectedElectionPeriod,
      conductedDigitalElectionsBefore:
        typeof conductedDigitalElectionsBefore === "boolean"
          ? conductedDigitalElectionsBefore
          : null,
      additionalInformation,
      preferredMeetingDate,
      preferredMeetingTime,
    });

    return res.status(201).json({
      success: true,
      message: "Demo request submitted",
      data: {
        requestId: request._id.toString(),
        status: request.status,
      },
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to submit demo request");
  }
};

export const createContactRequest = async (req, res) => {
  try {
    const {
      schoolName,
      contactName,
      email,
      populationBand,
      electionPackage,
      message,
    } = req.body || {};

    if (!schoolName || !contactName || !isValidEmail(email)) {
      return sendError(
        res,
        400,
        "schoolName, contactName, and a valid email are required"
      );
    }

    if (!ensureMinLength(message, 20)) {
      return sendError(res, 400, "Message must be at least 20 characters");
    }

    const request = await PublicLeadRequest.create({
      type: "contact",
      schoolName,
      contactName,
      email: normalizeEmail(email),
      populationBand,
      electionPackage,
      message,
    });

    return res.status(201).json({
      success: true,
      message: "Enquiry submitted",
      data: {
        requestId: request._id.toString(),
        status: request.status,
      },
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to submit enquiry");
  }
};

export const listPublicLeadRequestsForSuperAdmin = async (req, res) => {
  try {
    const type = String(req.query.type || "").trim();
    const status = String(req.query.status || "received").trim();
    const filter = {};

    if (type) {
      if (!["demo", "contact"].includes(type)) {
        return sendError(res, 400, "type must be demo or contact");
      }
      filter.type = type;
    }

    if (status) {
      if (!["received", "reviewing", "closed"].includes(status)) {
        return sendError(res, 400, "status must be received, reviewing, or closed");
      }
      filter.status = status;
    }

    const requests = await PublicLeadRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(250);

    return res.status(200).json(
      requests.map((request) => ({
        requestId: request._id.toString(),
        type: request.type,
        status: request.status,
        institutionName: request.institutionName,
        schoolName: request.schoolName,
        institutionType: request.institutionType,
        fullName: request.fullName,
        contactName: request.contactName,
        positionRole: request.positionRole,
        email: request.email,
        phoneNumber: request.phoneNumber,
        populationBand: request.populationBand,
        estimatedStudentPopulation: request.estimatedStudentPopulation,
        electionPackage: request.electionPackage,
        expectedElectionPeriod: request.expectedElectionPeriod,
        conductedDigitalElectionsBefore: request.conductedDigitalElectionsBefore,
        preferredMeetingDate: request.preferredMeetingDate,
        preferredMeetingTime: request.preferredMeetingTime,
        message: request.message,
        additionalInformation: request.additionalInformation,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load public lead requests");
  }
};

export const updatePublicLeadRequestStatusForSuperAdmin = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status } = req.body || {};
    if (!["received", "reviewing", "closed"].includes(status)) {
      return sendError(res, 400, "status must be received, reviewing, or closed");
    }

    const request = await PublicLeadRequest.findByIdAndUpdate(
      requestId,
      { $set: { status } },
      { new: true }
    );
    if (!request) {
      return sendError(res, 404, "Public lead request not found");
    }

    return res.status(200).json({
      requestId: request._id.toString(),
      type: request.type,
      status: request.status,
      updatedAt: request.updatedAt.toISOString(),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to update public lead request");
  }
};
