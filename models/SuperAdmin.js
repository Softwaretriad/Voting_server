import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { isValidEmail } from "../utils/security.js";

const SuperAdminSchema = new mongoose.Schema(
  {
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
    role: { type: String, enum: ["super_admin"], default: "super_admin" },
    isActive: { type: Boolean, default: true, index: true },
    refreshToken: { type: String, default: null },
    sessionVersion: { type: Number, default: 0, min: 0 },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

SuperAdminSchema.pre("save", async function preSave(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  return next();
});

SuperAdminSchema.methods.matchPassword = function matchPassword(plainText) {
  return bcrypt.compare(String(plainText || ""), this.password);
};

export default mongoose.models.SuperAdmin ||
  mongoose.model("SuperAdmin", SuperAdminSchema);
