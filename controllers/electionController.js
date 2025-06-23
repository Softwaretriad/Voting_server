import Election from "../models/Election.js";
import School from "../models/school.js";
import Voter from "../models/Voter.js";

export const uploadVoters = async (req, res) => {
  const { voters } = req.body; // array of { name, email, etc. }
  const schoolId = req.schoolId; // from auth middleware

  try {
    if (!Array.isArray(voters) || voters.length === 0) {
      return res.status(400).json({ error: "Voter list is empty" });
    }

    const votersWithSchool = voters.map(v => ({ ...v, schoolId }));
    await Voter.insertMany(votersWithSchool);

    res.status(201).json({ message: `${voters.length} voters uploaded` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const startElection = async (req, res) => {
  const { schoolId, title, durationHours = 24 } = req.body;

  try {
    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) return res.status(404).json({ error: "School not found" });

    // 1️⃣ Subscription check
    if (!school.subscriptionActive) {
      return res.status(403).json({ error: "Active subscription required" });
    }

    // 2️⃣ EC count check
    if (school.ecMembers.length < 3) {
      return res.status(403).json({ error: "At least 3 EC members required" });
    }

    // 3️⃣ Voter list check
    const voterCount = await Voter.countDocuments({ schoolId });
    if (voterCount === 0) {
      return res.status(400).json({ error: "Upload voter database first" });
    }

    // Create election
    const now = new Date();
    const end = new Date(now.getTime() + durationHours * 3600 * 1000);

    const election = await Election.create({
      schoolId,
      title,
      startTime: now,
      endTime: end,
      status: "active"
    });

    res.json({ message: "Election started", electionId: election._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
