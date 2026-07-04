import mongoose from "mongoose";
import { isValidEmail } from "../utils/security.js";

const SchoolStudentRecordSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    latestImportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudentRegisterImport",
      default: null,
    },
    studentId: { type: String, required: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
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
    gender: {
      type: String,
      enum: ["male", "female", ""],
      default: "",
      trim: true,
    },
    phone: { type: String, default: "", trim: true },
    faculty: { type: String, required: true, trim: true },
    nationality: { type: String, required: true, trim: true },
    programmeOfStudy: { type: String, trim: true, default: "" },
    level: { type: String, trim: true, default: "" },
    currentYearOfStudy: { type: Number, default: null, min: 1 },
    studentAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
    },
  },
  { timestamps: true }
);

SchoolStudentRecordSchema.index({ schoolId: 1, studentId: 1 }, { unique: true });
SchoolStudentRecordSchema.index({ schoolId: 1, email: 1 });
SchoolStudentRecordSchema.index({ schoolId: 1, firstName: 1, lastName: 1 });

export default mongoose.models.SchoolStudentRecord ||
  mongoose.model("SchoolStudentRecord", SchoolStudentRecordSchema);
