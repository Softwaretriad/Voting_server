import School from "../models/school.js";
import ECUser from "../models/ECUser.js";
import { normalizeEmail } from "../utils/security.js";

export const addECMember = async (req, res) => {
  const { schoolId, name, email, password } = req.body;

  try {
    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) return res.status(404).json({ error: "School not found" });

    if (school.ecMembers.length >= 5) {
      return res.status(400).json({ error: "Maximum 5 EC members allowed" });
    }

    const normalizedEmail = normalizeEmail(email);
    const existing = await ECUser.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const ec = await ECUser.create({
      name,
      email: normalizedEmail,
      password,
      schoolId,
    });

    school.ecMembers.push(ec._id);
    await school.save();

    return res.status(201).json({ message: "EC member added", ecId: ec._id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const listECMembers = async (req, res) => {
  const { schoolId } = req.params;

  try {
    const school = await School.findById(schoolId).populate("ecMembers", "-password");
    if (!school) return res.status(404).json({ error: "School not found" });
    res.json(school.ecMembers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const removeECMember = async (req, res) => {
  const { ecId } = req.params;
  const schoolId = req.schoolId;

  try {
    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) return res.status(404).json({ error: "School not found" });

    const ecIndex = school.ecMembers.findIndex((ec) => ec._id.toString() === ecId);
    if (ecIndex === -1) {
      return res.status(404).json({ error: "EC member not found" });
    }

    school.ecMembers.splice(ecIndex, 1);
    await school.save();
    await ECUser.findByIdAndDelete(ecId);

    res.json({ message: "EC member removed" });
  } catch (err) {
    console.error("Remove EC member error:", err);
    res.status(500).json({ error: err.message });
  }
};
