import jwt from "jsonwebtoken";
import Voter from "../models/Voter.js";
import dotenv from "dotenv";
dotenv.config();

export const protectVoter = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const voter = await Voter.findById(decoded.voterId);
    if (!voter) return res.status(401).json({ error: "Voter not found" });

    req.voter = voter;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
export const isVoterVerified = (req, res, next) => {
  if (!req.voter.isVerified) {
    return res.status(403).json({ error: "Voter not verified" });
  }
  next();
};