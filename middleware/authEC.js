import jwt from "jsonwebtoken";
import Student from "../models/Student.js";
import dotenv from "dotenv";
import { ecRoleQuery, isEcRole } from "../utils/ecRole.js";
dotenv.config();

export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role && !isEcRole(decoded.role)) {
      return res.status(401).json({ error: "Invalid token scope" });
    }

    const ecUser = await Student.findOne({
      _id: decoded.userId,
      accountRole: ecRoleQuery(),
    }).select("-password -votingPin");
    if (!ecUser) {
      return res.status(401).json({ error: "EC user not found" });
    }

    req.ecUser = ecUser;
    req.schoolId = decoded.schoolId || ecUser.schoolId;

    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
