import jwt from "jsonwebtoken";
import ECUser from "../models/ECUser.js";
import Student from "../models/Student.js";
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
    if (decoded.role && decoded.role !== "admin") {
      return res.status(401).json({ error: "Invalid token scope" });
    }

    let ecUser = await ECUser.findById(decoded.userId).select("-password");
    if (!ecUser) {
      ecUser = await Student.findOne({
        _id: decoded.userId,
        accountRole: "admin",
      }).select("-password -votingPin");
    }
    if (!ecUser) {
      return res.status(401).json({ error: "Admin user not found" });
    }

    req.ecUser = ecUser;
    req.schoolId = decoded.schoolId || ecUser.schoolId;

    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
