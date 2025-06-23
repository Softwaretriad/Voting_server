import Election from "../models/Election.js";

const checkElectionActive = async (req, res, next) => {
  const { voterId } = req.body;

  if (!voterId) {
    return res.status(400).json({ error: "Missing voterId in request body" });
  }

  try {
    const election = await Election.findOne({ isActive: true, "voters._id": voterId });

    if (!election) {
      return res.status(403).json({ error: "No active election found for this voter" });
    }

    const now = new Date();
    if (now > election.endTime) {
      return res.status(403).json({ error: "Voting has ended for this election" });
    }

    // Election still open, allow voting
    req.election = election; // Pass along if needed
    next();
  } catch (err) {
    res.status(500).json({ error: "Server error checking election status" });
  }
};

export default checkElectionActive;
