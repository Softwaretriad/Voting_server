import Voter from "../models/Voter.js";
import sendEmail from "../utils/sendEmail.js";

export const loginVoter = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    const voter = await Voter.findOne({ email: email.toLowerCase() });

    if (!voter) {
      return res.status(404).json({
        error: "This email is not registered as a voter. Please check with your EC."
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    voter.otp = otp;
    voter.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min from now
    await voter.save();

    // Send OTP email
    await sendEmail(voter.email, `Your OTP is: ${otp}`);

    return res.status(200).json({
      message: voter.hasVoted
        ? "OTP sent. You have already voted"
        : "OTP sent. Login initiated",
      voterId: voter._id,
      hasVoted: voter.hasVoted,
      name: voter.name,
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
};
