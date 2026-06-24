import mongoose from "mongoose";

const AspirantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    studentId: { type: String, required: true, trim: true },
    programmeOfStudy: { type: String, required: true, trim: true },
    level: { type: String, required: true, trim: true, alias: "currentYearOfStudy" },
    faculty: { type: String, required: true, trim: true, alias: "department" },
    electoralCategory: {
      type: String,
      required: true,
      trim: true,
      alias: "position",
    },
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },
    electionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Election",
      default: null,
    },
    categoryId: { type: mongoose.Schema.Types.ObjectId, default: null },
    imageUrl: { type: String, trim: true, default: "" },
    title: { type: String, required: true, trim: true },
    voteCount: { type: Number, default: 0 },
  },
  {
    collection: "aspirants",
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

AspirantSchema.index({ electionId: 1, schoolId: 1, categoryId: 1 });

export default mongoose.models.Aspirant ||
  mongoose.model("Aspirant", AspirantSchema);
