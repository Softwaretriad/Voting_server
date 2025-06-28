import School from "../models/school.js";
import ECUser from "../models/ECUser.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import Candidate from "../models/candidates.js";
import Election from "../models/Election.js";
import Voter from "../models/Voter.js";

dotenv.config();

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


export const ecDashboard = async (req, res) => {
  const schoolId = req.schoolId;

  try {
    // Get total registered voters
    const totalVoters = await Voter.countDocuments({ schoolId });
    
    // Get active or latest election
    const election = await Election.findOne({
      schoolId,
      status: { $in: ["active", "ended"] }
    }).sort({ startTime: -1 });

    // Get total who have voted
    const totalVotes = election?.votes?.length || 0;
    const uniqueVoters = new Set(election.votes.map(v => v.voterId.toString())).size;

    // Get vote counts per candidate
    const candidates = await Candidate.find({ schoolId });

    // Map each candidate with their vote count from the election votes array
    const candidateStats = candidates.map(candidate => {
      const count = election?.votes.filter(
        v => v.candidate.includes(candidate.name)
      ).length;
      return {
        name: candidate.name,
        position: candidate.position,
        voteCount: count || 0
      };
    });

    res.json({
      schoolId,
      electionTitle: election?.title || "No election yet",
      totalVoters,
      totalVotes,
      uniqueVoters,
      electionStatus: election?.status || "No active election",
      electionStartTime: election?.startTime || null,
      electionEndTime: election?.endTime || null,
      hasEnded: election?.status === "ended",
      candidates: candidateStats
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ error: "Server error loading dashboard" });
  }
};

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

/** Remove an EC member */
export const removeECMember = async (req, res) => {
  const { ecId } = req.params;
  const schoolId = req.schoolId;

  try {
    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) return res.status(404).json({ error: "School not found" });

    const ecIndex = school.ecMembers.findIndex(ec => ec._id.toString() === ecId);
    if (ecIndex === -1) return res.status(404).json({ error: "EC member not found" });

    school.ecMembers.splice(ecIndex, 1);
    await school.save();

    await ECUser.findByIdAndDelete(ecId);

    res.json({ message: "✅ EC member removed" });
  } catch (err) {
    console.error("❌ Remove EC member error:", err);
    res.status(500).json({ error: err.message });
  }
};


/** Get all candidates for a school */
export const getCandidates = async (req, res) => {
  const schoolId = req.schoolId;

  try {
    const candidates = await Candidate.find({ schoolId }).select("-__v");

    if (candidates.length === 0) {
      return res.status(404).json({ error: "No candidates found for this school" });
    }

    // Get the current election (active or most recent ended one)
    const election = await Election.findOne({
      schoolId,
      status: { $in: ["active", "ended"] }
    });

    // Count votes per candidate
    const enriched = candidates.map(c => {
      const voteCount = election
        ? election.votes.filter(v => v.candidate.includes(c.name)).length
        : 0;
      return {
        _id: c._id,
        name: c.name,
        position: c.position,
        votes: voteCount
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error("❌ Get candidates error:", err);
    res.status(500).json({ error: err.message });
  }
};

