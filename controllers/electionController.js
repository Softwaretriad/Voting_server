import Election from "../models/Election.js";
import Voter from "../models/Voter.js";

export const uploadVoters = async (req, res) => {
  const voters = req.body.voters;
  if (!Array.isArray(voters) || voters.length === 0) {
    return res.status(400).json({ error: "Provide voters array" });
  }
  try {
    const existingCount = await Voter.countDocuments({ ecId: req.user._id });
const incomingCount = voters.length;

if (existingCount + incomingCount > req.user.maxVoters) {
  return res.status(400).json({
    error: `Your plan allows up to ${req.user.maxVoters} voters only.`
  });
}
    await Voter.deleteMany({ ecId: req.user._id, hasVoted: false });
    const docs = voters.map(v => ({ ...v, ecId: req.user._id }));
    await Voter.insertMany(docs);
    res.json({ message: "Voters uploaded", count: docs.length });
  } catch (err) {
    res.status(500).json({ error: "Upload error" });
  }
};

export const startElection = async (req, res) => {
  const { title, durationHours } = req.body;
  try {
    const voterCount = await Voter.countDocuments({ ecId: req.user._id });
    if (voterCount === 0) {
      return res.status(400).json({ error: "Upload voter database first" });
    }
    const now = new Date();
    const end = new Date(now.getTime() + (durationHours || 24) * 3600 * 1000);
    const election = await Election.create({
      ecId: req.user._id,
      title,
      startTime: now,
      endTime: end,
      status: "active"
    });
    res.json({ message: "Election started", electionId: election._id });
  } catch (err) {
    res.status(500).json({ error: "Error starting election" });
  }
};

export const dashboard = async (req, res) => {
  res.send(`Welcome ${req.user.email}. Your plan is ${req.user.plan}`);
};
