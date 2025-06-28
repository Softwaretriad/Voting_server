import Voter from "../models/Voter.js";
import Election from "../models/Election.js";

export const castVote = async (req, res) => {
  const { candidate } = req.body;
  const voter = req.voter;

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

    // check if candidate exists in the current election
    const isValidCandidate = election.candidates.includes(candidate);
    if (!isValidCandidate) {
      return res.status(400).json({ error: "Invalid candidate selected" });
    }

    // ✅ Record vote
    election.votes.push({ candidate, voterId: voter._id });
    await election.save();

    // ✅ Update voter status
    voter.hasVoted = true;
    await voter.save();

    res.json({ message: "✅ Vote cast successfully" });
  } catch (err) {
    console.error("❌ Vote Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
