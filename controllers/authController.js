import ECUser from "../models/ECUser.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

import plans from "../utils/plans.js";

export const registerEC = async (req, res) => {
  try {
    console.log("BODY:", req.body);

    const { email, password, plan } = req.body;
    if (!email || !password || !plan) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const selectedPlan = plans[plan] || plans.basic;

    const user = await ECUser.create({
      email,
      password,
      plan,
      maxVoters: selectedPlan.maxVoters
    });

    res.status(201).json({ message: "EC created", user });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};


export const loginEC = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await ECUser.findOne({ email });
    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    res.json({
      token,
      user: { id: user._id, email: user.email, plan: user.plan }
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};
