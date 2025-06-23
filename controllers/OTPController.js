import jwt from "jsonwebtoken";

export const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  try {
    const voter = await Voter.findOne({ email });
    if (!voter || voter.otp !== otp || voter.otpExpires < new Date()) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    voter.isVerified = true;
    voter.otp = null;
    voter.otpExpires = null;
    await voter.save();

    const token = jwt.sign({ voterId: voter._id }, process.env.JWT_SECRET, {
      expiresIn: "2h",
    });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
