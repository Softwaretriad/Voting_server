import mongoose from "mongoose";

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

const SchoolSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  fullName: { type: String, trim: true },
  shortName: { type: String, trim: true, default: "" },
  logoUrl: { type: String, trim: true, default: "" },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  plan: {
    type: String,
    enum: ["free", "micro", "small", "medium", "large", "enterprise"],
    default: "free",
  },
  subscriptionActive: { type: Boolean, default: true },
  subscriptionStartedAt: { type: Date, default: Date.now },
  subscriptionTerm: {
    type: String,
    enum: ["1_month", "one_off_election", "3_months", "6_months", "1_year"],
    default: "1_month",
  },
  subscriptionExpiresAt: { type: Date, default: null },
  oneOffElectionConsumed: { type: Boolean, default: false },
  ecMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: "ECUser" }],
  faculties: { type: [FacultySchema], default: [] },
});

SchoolSchema.pre("save", function preSave(next) {
  if (!this.fullName) {
    this.fullName = this.name;
  }

  next();
});

export default mongoose.model("School", SchoolSchema);
