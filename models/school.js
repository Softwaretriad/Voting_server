import mongoose from "mongoose";
import { normalizeAllowedEmailDomains } from "../utils/emailDomains.js";
import { isValidEmail } from "../utils/security.js";

const ProgrammeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    durationYears: { type: Number, default: 4, min: 1 },
  },
  { _id: true }
);

const FacultySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    programmes: { type: [ProgrammeSchema], default: [] },
  },
  { _id: true }
);

const OfficialDocumentSchema = new mongoose.Schema(
  {
    storagePath: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true },
    mimeType: {
      type: String,
      required: true,
      enum: ["image/jpeg", "image/png", "image/webp"],
    },
    size: { type: Number, required: true, min: 1 },
    sha256: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
    },
    encryption: {
      algorithm: { type: String, required: true, enum: ["aes-256-gcm"] },
      iv: { type: String, required: true },
      authTag: { type: String, required: true },
    },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const SchoolSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  fullName: { type: String, trim: true },
  shortName: { type: String, trim: true, default: "" },
  logoUrl: { type: String, trim: true, default: "" },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: isValidEmail,
      message: "email must be a valid email address",
    },
  },
  allowedEmailDomains: {
    type: [String],
    default: [],
    set: normalizeAllowedEmailDomains,
  },
  plan: {
    type: String,
    enum: ["free", "micro", "small", "medium", "large", "enterprise"],
    default: "free",
  },
  subscriptionActive: { type: Boolean, default: true },
  subscriptionStartedAt: { type: Date, default: Date.now },
  subscriptionTerm: {
    type: String,
    enum: ["one_off_election", "4_months", "1_year"],
    default: "4_months",
  },
  subscriptionExpiresAt: { type: Date, default: null },
  oneOffElectionConsumed: { type: Boolean, default: false },
  registrationStatus: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "approved",
    index: true,
  },
  registrationSubmittedAt: { type: Date, default: null },
  registrationReviewedAt: { type: Date, default: null },
  registrationReviewedBy: { type: String, trim: true, default: "" },
  registrationRejectionReason: { type: String, trim: true, default: "" },
  officialDocuments: { type: [OfficialDocumentSchema], default: [] },
  ecMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Student" }],
  faculties: { type: [FacultySchema], default: [] },
});

SchoolSchema.pre("save", function preSave(next) {
  if (!this.fullName) {
    this.fullName = this.name;
  }

  this.allowedEmailDomains = normalizeAllowedEmailDomains(this.allowedEmailDomains);

  next();
});

export default mongoose.model("School", SchoolSchema);
