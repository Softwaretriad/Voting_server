import jwt from "jsonwebtoken";
import ECUser from "../models/ECUser.js";
import dotenv from "dotenv";
dotenv.config();

export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("Decoded token:", decoded);

    const ecUser = await ECUser.findById(decoded.userId).select("-password");
    if (!ecUser) {
      return res.status(401).json({ error: "EC user not found" });
    }

    req.ecUser = ecUser;
    req.schoolId = decoded.schoolId;

    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

