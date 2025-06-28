import Election from "../models/Election.js";
import mongoose from "mongoose";

const checkElectionActive = async (req, res, next) => {
  const voter = req.voter;

  if (!voter) {
    return res.status(401).json({ error: "Unauthorized: Voter not found in request" });
  }

  try {
    const election = await Election.findOne({
      schoolId: new mongoose.Types.ObjectId(voter.schoolId),
      status: "active"
    });

    if (!election) {
      return res.status(403).json({ error: "No active election found for this voter's school" });
    }

    const now = new Date();
    if (now > election.endTime) {
      return res.status(403).json({ error: "Voting has ended for this election" });
    }

    req.election = election; // Pass the election to the next middleware or handler
    next();
  } catch (err) {
    console.error("Election check error:", err);
    res.status(500).json({ error: "Server error checking election status" });
  }
};

export default checkElectionActive;
