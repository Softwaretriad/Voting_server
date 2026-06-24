import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { isValidEmail } from "../utils/security.js";

const SchoolAdminSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      unique: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
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
    password: { type: String, required: true },
    role: { type: String, enum: ["school_admin"], default: "school_admin" },
    isActive: { type: Boolean, default: true, index: true },
    refreshToken: { type: String, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SchoolAdminSchema.pre("save", async function preSave(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  return next();
});

SchoolAdminSchema.methods.matchPassword = function matchPassword(plainText) {
  return bcrypt.compare(String(plainText || ""), this.password);
};

export default mongoose.models.SchoolAdmin ||
  mongoose.model("SchoolAdmin", SchoolAdminSchema);
