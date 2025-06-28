import Election from "../models/Election.js";
import School from "../models/school.js";
import Voter from "../models/Voter.js";
import Candidate from "../models/candidates.js";


export const uploadVoters = async (req, res) => {
  const { voters } = req.body;
  const schoolId = req.schoolId;       
  const ecId = req.ecUser._id;         

  try {
    if (!Array.isArray(voters) || voters.length === 0) {
      return res.status(400).json({ error: "Voter list is empty" });
    }

    const votersWithMeta = voters.map(v => ({
      ...v,
      schoolId,
      ecId
    }));

    await Voter.insertMany(votersWithMeta);

    const count = await Voter.countDocuments({ schoolId });
    console.log("🧾 Voters found for school:", schoolId, "→", count);

    res.status(201).json({ message: `${voters.length} voters uploaded` });
  } catch (err) {
    console.error("Upload voters error:", err);
    res.status(500).json({ error: err.message });
  }
};
 

export const startElection = async (req, res) => {
  const { schoolId, title, durationHours = 24 } = req.body;

  try {
    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) return res.status(404).json({ error: "School not found" });

    if (!school.subscriptionActive) {
      return res.status(403).json({ error: "Active subscription required" });
    }

    if (school.ecMembers.length < 3) {
      return res.status(403).json({ error: "At least 3 EC members required" });
    }

    const voterCount = await Voter.countDocuments({ schoolId });
    if (voterCount === 0) {
      return res.status(400).json({ error: "Upload voter database first" });
    }

    // ✅ Load candidates from Candidate model
    const candidates = await Candidate.find({ schoolId, title });
    if (candidates.length === 0) {
      return res.status(400).json({ error: "Upload candidates before starting election" });
    }

    const now = new Date();
    const end = new Date(now.getTime() + durationHours * 3600 * 1000);

    const election = await Election.create({
      schoolId,
      title,
      startTime: now,
      endTime: end,
      status: "active",
      candidates, 
    });

    res.json({ message: "Election started", electionId: election._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


