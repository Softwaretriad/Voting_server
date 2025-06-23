import Voter from "../models/Voter.js";
import Election from "../models/Election.js";

export const castVote = async (req, res) => {
  const { candidate } = req.body;
  const voter = req.voter; // from protectVoter middleware

  try {
    if (!voter) return res.status(401).json({ error: "Unauthorized" });

    if (voter.hasVoted) {
      return res.status(403).json({ error: "You have already voted" });
    }

    const election = await Election.findOne({
      schoolId: voter.schoolId,
      status: "active",
    });

    if (!election) {
      return res.status(400).json({ error: "No active election found" });
    }

    // Add vote (optionally include voterId to prevent double-voting at backend level)
    election.votes.push({ candidate, voterId: voter._id });
    await election.save();

    voter.hasVoted = true;
    await voter.save();

    res.json({ message: "✅ Vote cast successfully" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};
