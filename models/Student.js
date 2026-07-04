import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import {
  hashPin,
  isHashedValue,
  isPinHashValue,
  isValidEmail,
} from "../utils/security.js";
import { EC_ROLE, STUDENT_ROLE } from "../utils/ecRole.js";

const StudentSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    gender: {
      type: String,
      enum: ["male", "female"],
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: isValidEmail,
        message: "email must be a valid email address",
      },
    },
    password: { type: String, required: true },
    passwordLoginEnabled: { type: Boolean, default: true },
    phone: { type: String, required: true, trim: true },
    schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", default: null },
    accountRole: {
      type: String,
      enum: [STUDENT_ROLE, EC_ROLE],
      default: STUDENT_ROLE,
      index: true,
    },
    ecAssignedAt: { type: Date, default: null },
    ecAssignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    universityFullName: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    currentYearOfStudy: { type: Number, default: null, min: 1 },
    programOfStudy: { type: String, required: true, trim: true },
    nationality: { type: String, default: "", trim: true },
    votingPin: { type: String, default: null },
    authProvider: {
      type: String,
      enum: ["password", "google", "imported"],
      default: "password",
      index: true,
    },
    googleSub: { type: String, default: null, trim: true },
    googleLinkedAt: { type: Date, default: null },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationOtp: { type: String, default: null },
    emailVerificationOtpExpires: { type: Date, default: null },
    passwordResetOtp: { type: String, default: null },
    passwordResetOtpExpires: { type: Date, default: null },
    votingPinResetOtp: { type: String, default: null },
    votingPinResetOtpExpires: { type: Date, default: null },
    votingPinResetTokenHash: { type: String, default: null },
    votingPinResetTokenExpires: { type: Date, default: null },
    refreshToken: { type: String, default: null },
    sessionVersion: { type: Number, default: 0, min: 0 },
    passwordResetTokenHash: { type: String, default: null },
    passwordResetTokenExpires: { type: Date, default: null },
    votingPinAttempts: { type: Number, default: 0 },
    votingPinLockedUntil: { type: Date, default: null },
    notificationPreferences: {
      notificationsEnabled: { type: Boolean, default: true },
      electionAlertsEnabled: { type: Boolean, default: true },
      resultsEnabled: { type: Boolean, default: true },
      announcementsEnabled: { type: Boolean, default: true },
      voterActivityEnabled: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

StudentSchema.pre("save", async function preSave(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

StudentSchema.pre("save", async function preSaveVotingPin(next) {
  if (!this.isModified("votingPin")) return next();
  if (this.votingPin == null || this.votingPin === "") return next();
  if (isHashedValue(this.votingPin) || isPinHashValue(this.votingPin)) return next();
  this.votingPin = await hashPin(this.votingPin);
  next();
});

StudentSchema.methods.matchPassword = function matchPassword(plainText) {
  if (this.passwordLoginEnabled === false) return false;
  return bcrypt.compare(plainText, this.password);
};

StudentSchema.index({ schoolId: 1, accountRole: 1 });
StudentSchema.index({ schoolId: 1, studentId: 1 });
StudentSchema.index({ googleSub: 1 }, { unique: true, sparse: true });

export default mongoose.model("Student", StudentSchema);
