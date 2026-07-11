import mongoose from "mongoose";

const SchoolLogoUploadSchema = new mongoose.Schema(
  {
    uploadId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    url: { type: String, required: true, trim: true },
    storagePath: { type: String, required: true, trim: true },
    originalName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true, enum: ["image/webp"] },
    size: { type: Number, required: true, min: 1 },
    consumedAt: { type: Date, default: null },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

export default mongoose.model("SchoolLogoUpload", SchoolLogoUploadSchema);
