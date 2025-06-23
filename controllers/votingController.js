export const castVote = async (req, res) => {
  const { voterId, candidate } = req.body;

  try {
    const voter = await Voter.findById(voterId);
    if (!voter) return res.status(404).json({ error: "Voter not found" });

    if (voter.hasVoted) {
      return res.status(403).json({ error: "Already voted" });
    }

    const election = await Election.findOne({ ecId: voter.ecId, isActive: true });
    if (!election) return res.status(400).json({ error: "No active election" });

    election.votes.push({ candidate });
    await election.save();

    voter.hasVoted = true;
    await voter.save();

    res.json({ message: "Vote submitted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
