import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const ECUserSchema = new mongoose.Schema({
  firstname: { type: String, default: "", trim: true },
  firstName: { type: String, default: "", trim: true },
  lastName: { type: String, default: "", trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, default: null },
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
  status: {
    type: String,
    enum: ["pending", "active"],
    default: "active",
  },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "ECUser", default: null },
  inviteTokenHash: { type: String, default: null },
  inviteTokenExpires: { type: Date, default: null },
  invitationAcceptedAt: { type: Date, default: null },
  passwordResetOtp: { type: String, default: null },
  passwordResetOtpExpires: { type: Date, default: null },
  passwordResetTokenHash: { type: String, default: null },
  passwordResetTokenExpires: { type: Date, default: null },
  refreshToken: { type: String, default: null },
  notificationPreferences: {
    notificationsEnabled: { type: Boolean, default: true },
    electionAlertsEnabled: { type: Boolean, default: true },
    resultsEnabled: { type: Boolean, default: true },
    announcementsEnabled: { type: Boolean, default: true },
    voterActivityEnabled: { type: Boolean, default: true },
  },
  plan: {
    type: String,
    enum: ["free", "micro", "small", "medium", "large", "enterprise"],
    default: "free",
  },
  maxVoters: { type: Number, default: 1000 }
});

ECUserSchema.virtual("name")
  .get(function getName() {
    return [this.firstName || this.firstname, this.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
  })
  .set(function setName(value) {
    const normalized = String(value || "").trim();
    if (!normalized) {
      this.firstName = "";
      this.firstname = "";
      this.lastName = "";
      return;
    }

    const parts = normalized.split(/\s+/);
    const firstName = parts.shift() || "";
    const lastName = parts.join(" ");

    this.firstName = firstName;
    this.firstname = firstName;
    this.lastName = lastName;
  });

ECUserSchema.pre("save", function normalizeNameFields(next) {
  if (!this.firstName && this.firstname) {
    this.firstName = this.firstname;
  }

  if (!this.firstname && this.firstName) {
    this.firstname = this.firstName;
  }

  next();
});


ECUserSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

ECUserSchema.methods.matchPassword = function (plain) {
  if (!this.password) {
    return false;
  }
  return bcrypt.compare(plain, this.password);
};

export default mongoose.model("ECUser", ECUserSchema);
