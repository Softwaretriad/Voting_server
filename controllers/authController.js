import School from "../models/school.js";
import ECUser from "../models/ECUser.js";
import plans from "../utils/plans.js";
import { normalizeEmail } from "../utils/security.js";

export const registerEC = async (req, res) => {
  try {
    const { name, email, password, plan, schoolId } = req.body;

    if (!email || !password || !plan || !name || !schoolId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ error: "Admin password must be at least 8 characters" });
    }

    const selectedPlan = plans[plan] || plans.basic;
    const normalizedEmail = normalizeEmail(email);
    const existing = await ECUser.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) {
      return res.status(404).json({ error: "School not found" });
    }

    const alreadyInSchool = school.ecMembers.some((ec) => ec.email === normalizedEmail);
    if (alreadyInSchool) {
      return res.status(400).json({ error: "EC already part of this school" });
    }

    if (school.ecMembers.length >= 5) {
      return res.status(400).json({ error: "Maximum of 5 EC members allowed" });
    }

    const user = await ECUser.create({
      name,
      email: normalizedEmail,
      password,
      plan,
      maxVoters: selectedPlan.maxVoters,
      schoolId,
    });

    school.ecMembers.push(user._id);
    await school.save();

    res.status(201).json({ message: "EC registered and added to school", user });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};
