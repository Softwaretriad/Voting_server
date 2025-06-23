import Voter from "../models/Voter.js";

export const loginVoter = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const voter = await Voter.findOne({ email: email.toLowerCase() });

    if (!voter) {
      return res.status(404).json({
        error: "This email is not registered as a voter. Please check with your EC."
      });
    }

    // Allow login even if they already voted
    return res.status(200).json({
      message: voter.hasVoted ? "You have already voted" : "Login successful",
      voterId: voter._id,
      hasVoted: voter.hasVoted,
      name: voter.name
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

export const getUserDashboard = async (req, res) => {
  const { voterId } = req.params;

  try {
    const voter = await Voter.findById(voterId);
    if (!voter) return res.status(404).json({ error: "Voter not found" });

    const election = await Election.findOne({ ecId: voter.ecId, status: { $in: ["active", "ended"] } });
    if (!election) return res.status(404).json({ error: "No associated election found" });

    const now = new Date();
    const ended = now > election.endTime;

    const dashboard = {
      electionTitle: election.title,
      endsAt: election.endTime,
      hasEnded: ended,
      hasVoted: voter.hasVoted,
      voteStatus: voter.hasVoted ? "Vote submitted ✅" : "You have not voted ❌",
      canVote: !voter.hasVoted && !ended,
      candidates: !voter.hasVoted && !ended ? election.candidates : undefined, // optional
    };

    res.json(dashboard);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};