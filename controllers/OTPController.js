import jwt from "jsonwebtoken";
export const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  try {
    const voter = await Voter.findOne({ email: email.toLowerCase() });

    if (!voter) {
      console.log("Voter not found");
      return res.status(404).json({ error: "Voter not found" });
    }

    if (
      voter.otp !== otp ||
      !voter.otpExpires ||
      voter.otpExpires < Date.now()
    ) {
      console.log("Invalid or expired OTP");
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    voter.isVerified = true;
    voter.otp = null;
    voter.otpExpires = null;
    await voter.save();

    const token = jwt.sign(
      { voterId: voter._id },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.json({ token, voterId: voter._id, hasVoted: voter.hasVoted });

  } catch (err) {
    console.error("OTP Verification Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

/*export const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  try {
    const voter = await Voter.findOne({ email: email.toLowerCase() });
    if (
      !voter ||
      voter.otp !== otp ||
      !voter.otpExpires ||
      voter.otpExpires < Date.now()
    ) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    voter.isVerified = true;
    voter.otp = null;
    voter.otpExpires = null;
    await voter.save();

    const token = jwt.sign(
      { voterId: voter._id },
      process.env.JWT_SECRET,
      { expiresIn: "" }
    );

    return res.json({ token, voterId: voter._id, hasVoted: voter.hasVoted });
  } catch (err) {
    console.error("OTP ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

/*export const verifyOtp = async (req, res) => {
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
      expiresIn: "30m",
    });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};*/
