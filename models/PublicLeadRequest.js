import mongoose from "mongoose";
import { isValidEmail } from "../utils/security.js";

const PublicLeadRequestSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ["demo", "contact"],
      index: true,
    },
    status: {
      type: String,
      enum: ["received", "reviewing", "closed"],
      default: "received",
      index: true,
    },
    institutionName: { type: String, trim: true, default: "" },
    institutionType: {
      type: String,
      enum: ["university", "college", "polytechnic", "other", ""],
      default: "",
    },
    schoolName: { type: String, trim: true, default: "" },
    fullName: { type: String, trim: true, default: "" },
    contactName: { type: String, trim: true, default: "" },
    positionRole: { type: String, trim: true, default: "" },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: isValidEmail,
        message: "email must be a valid email address",
      },
    },
    phoneNumber: { type: String, trim: true, default: "" },
    populationBand: { type: String, trim: true, default: "" },
    estimatedStudentPopulation: { type: String, trim: true, default: "" },
    electionPackage: { type: String, trim: true, default: "" },
    expectedElectionPeriod: { type: String, trim: true, default: "" },
    conductedDigitalElectionsBefore: { type: Boolean, default: null },
    preferredMeetingDate: { type: String, trim: true, default: "" },
    preferredMeetingTime: { type: String, trim: true, default: "" },
    message: { type: String, trim: true, default: "" },
    additionalInformation: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

PublicLeadRequestSchema.index({ type: 1, createdAt: -1 });

export default mongoose.models.PublicLeadRequest ||
  mongoose.model("PublicLeadRequest", PublicLeadRequestSchema);
