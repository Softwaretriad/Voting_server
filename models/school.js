import mongoose from "mongoose";

const SchoolSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },           // school admin
  plan: {
    type: String,
    enum: ["basic", "standard", "premium"],
    required: true
  },
  subscriptionActive: { type: Boolean, default: true },
  ecMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: "ECUser" }]
});

export default mongoose.model("School", SchoolSchema);
