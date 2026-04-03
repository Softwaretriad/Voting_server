import mongoose from "mongoose";

const NewsSchema = new mongoose.Schema(
  {
    schoolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      default: null,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    imageUrl: { type: String, required: true, trim: true },
    publishedAt: { type: Date, default: Date.now, index: true },
    isTrending: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("News", NewsSchema);
