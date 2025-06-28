import School from "../models/school.js";
import ECUser from "../models/ECUser.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import Candidate from "../models/candidates.js";
import Election from "../models/Election.js";

dotenv.config();

/** Add EC member (≤ 5 per school) */
export const addECMember = async (req, res) => {
  const { schoolId, name, email, password } = req.body;

  try {
    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) return res.status(404).json({ error: "School not found" });

    if (school.ecMembers.length >= 5) {
      return res.status(400).json({ error: "Maximum 5 EC members allowed" });
    }

    const existing = await ECUser.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const ec = await ECUser.create({ name, email, password, schoolId });
    school.ecMembers.push(ec._id);
    await school.save();

    return res.status(201).json({ message: "EC member added", ecId: ec._id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const uploadCandidates = async (req, res) => {
  const { candidates, title } = req.body;
  const schoolId = req.schoolId;

  try {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: "Candidate list is empty" });
    }

    for (const c of candidates) {
      if (!c.name || !c.position) {
        return res.status(400).json({ error: "Each candidate must have a name and position" });
      }
      
      await Candidate.create({
        name: c.name.trim(),
        position: c.position.trim(),
        schoolId,
        title
      });
    }

    res.status(201).json({ message: `${candidates.length} candidates uploaded` });
  } catch (err) {
    console.error("Upload candidates error:", err);
    res.status(500).json({ error: err.message });
  }
};


/** List EC members for a school */
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

/** EC login (email + password → JWT) */
export const loginEC = async (req, res) => {
  const { email, password } = req.body;
  try {
    const ec = await ECUser.findOne({ email }).populate("schoolId");
    if (!ec || !(await ec.matchPassword(password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ userId: ec._id, schoolId: ec.schoolId._id }, process.env.JWT_SECRET, {
      expiresIn: "1d"
    });
    res.json({ token, ecId: ec._id, schoolId: ec.schoolId._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
