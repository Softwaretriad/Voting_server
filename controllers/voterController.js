import Voter from "../models/Voter.js";
import Election from "../models/Election.js";
import sendEmail from "../utils/sendEmail.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();


export const loginVoter = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const voter = await Voter.findOne({ email: email.toLowerCase() });
    if (!voter)
      return res.status(404).json({ error: "Email not registered for voting" });

    // 6-digit OTP, valid 10 min
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    voter.otp = otp;
    voter.otpExpires = Date.now() + 10 * 60 * 1000;
   await voter.save({ validateBeforeSave: false });


    await sendEmail(voter.email, `Your OTP is: ${otp}`);
    res.json({
      message: voter.hasVoted
        ? "OTP sent – you have already voted"
        : "OTP sent – check your email",
      voterId: voter._id,
      hasVoted: voter.hasVoted,
      name: voter.name,
    });
  } catch (err) {
  console.error("Login Error:", err); 
  res.status(500).json({ error: "Server error" });
}
};


export const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  try {
    console.log("🔍 Verifying OTP for:", email, otp);

    const voter = await Voter.findOne({ email: email.toLowerCase() });
    if (!voter) {
      console.log("❌ Voter not found");
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    if (
      voter.otp !== otp ||
      !voter.otpExpires ||
      voter.otpExpires < Date.now()
    ) {
      console.log("❌ OTP invalid or expired");
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    voter.isVerified = true;
    voter.otp = null;
    voter.otpExpires = null;
    await voter.save();

    const token = jwt.sign({ voterId: voter._id }, process.env.JWT_SECRET, {
      expiresIn: "2h",
    });

    res.json({ token, voterId: voter._id, hasVoted: voter.hasVoted });
  } catch (err) {
    console.error("❌ OTP Verification Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};


export const getUserDashboard = async (req, res) => {
  // Use req.voter if middleware was used, else fallback to params
  const voter = req.voter || (await Voter.findById(req.params.voterId));

  try {
    if (!voter) return res.status(404).json({ error: "Voter not found" });

    const election = await Election.findOne({
      schoolId: voter.schoolId,
      status: { $in: ["active", "ended"] },
    });

    if (!election) {
      return res.status(404).json({ error: "No election found for your school" });
    }

    const now = Date.now();
    const hasEnded = now > election.endTime;

    const candidateData =
      hasEnded
        ? await Candidate.find({ schoolId: voter.schoolId }, "name position voteCount")
        : election.candidates;

    res.json({
      electionTitle: election.title,
      endsAt: election.endTime,
      hasEnded,
      voteStatus: voter.hasVotedPositions?.length
        ? `✅ Voted for: ${voter.hasVotedPositions.join(", ")}`
        : "❌ You haven't voted yet",
      canVote: !hasEnded,
      votedPositions: voter.hasVotedPositions || [],
      candidates: candidateData,
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json({ error: "Server error" });
  }
};


export const getVoterById = async (req, res) => {
  const { voterId } = req.params;
  try {
    const voter = await Voter.findById(voterId).select("-otp -otpExpires");
    if (!voter) return res.status(404).json({ error: "Voter not found" });
    res.json(voter);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};
