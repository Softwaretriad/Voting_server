import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const ECUserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: "School", required: true },
  plan: { type: String, enum: ["basic", "standard", "premium"], default: "basic" },
  maxVoters: { type: Number, default: 1000 }
});


ECUserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

ECUserSchema.methods.matchPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

export default mongoose.model("ECUser", ECUserSchema);
