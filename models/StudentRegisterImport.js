import mongoose from "mongoose";

const StudentRegisterImportSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolAdmin",
      required: true,
    },
    fileName: { type: String, required: true, trim: true },
    mimeType: { type: String, trim: true, default: "" },
    rowsProcessed: { type: Number, default: 0, min: 0 },
    rowsImported: { type: Number, default: 0, min: 0 },
    studentAccountsUpserted: { type: Number, default: 0, min: 0 },
    rowsSkipped: { type: Number, default: 0, min: 0 },
    requiredColumnsValidated: { type: Boolean, default: false },
    skippedRows: {
      type: [
        {
          rowNumber: Number,
          reason: String,
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

StudentRegisterImportSchema.index({ schoolId: 1, createdAt: -1 });

export default mongoose.models.StudentRegisterImport ||
  mongoose.model("StudentRegisterImport", StudentRegisterImportSchema);
