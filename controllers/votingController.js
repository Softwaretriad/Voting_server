import mongoose from "mongoose";
import Election from "../models/Election.js";
import Candidate from "../models/candidates.js";


export const castVote = async (req, res) => {
  const { candidateName, position } = req.body;
  const voter = req.voter;

  try {
    if (!voter) return res.status(401).json({ error: "Unauthorized" });
    if (voter.hasVotedPositions?.includes(position)) {
      return res.status(403).json({ error: `You've already voted for ${position}` });
    }

    const election = await Election.findOne({
      schoolId: voter.schoolId,
      status: "active"
    });

    if (!election) {
      return res.status(400).json({ error: "No active election found" });
    }

    const matched = election.candidates.find(c =>
      c?.name?.trim().toLowerCase() === candidateName?.trim().toLowerCase() &&
      c?.position?.trim().toLowerCase() === position?.trim().toLowerCase()
    );

    if (!matched) {
      return res.status(400).json({ error: "Invalid candidate or position selected" });
    }

    // Update vote count in Candidates table
    const candidateDoc = await Candidate.findOne({
      name: matched.name,
      position: matched.position,
      schoolId: voter.schoolId
    });

    if (!candidateDoc) {
      return res.status(400).json({ error: "Candidate record not found" });
    }

    candidateDoc.voteCount = (candidateDoc.voteCount || 0) + 1;
    await candidateDoc.save();

    // Record vote in election
    election.votes.push({
      candidate: `${matched.name} - ${matched.position}`,
      voterId: voter._id
    });
    await election.save();

    // Track positions voted on (per voter)
    voter.hasVotedPositions = [...(voter.hasVotedPositions || []), position];
    await voter.save();

    res.json({
      message: `✅ Vote cast for ${matched.name} as ${matched.position}`,
      voteCount: candidateDoc.voteCount
    });
  } catch (err) {
    console.error("❌ Vote Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};
