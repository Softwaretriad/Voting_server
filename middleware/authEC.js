import Student from "../models/Student.js";
import dotenv from "dotenv";
import { ecRoleQuery, isEcRole } from "../utils/ecRole.js";
import { verifyToken } from "../utils/studentAuth.js";
dotenv.config();

export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = verifyToken(token);
    if (!isEcRole(decoded.role) || decoded.type !== "access") {
      return res.status(401).json({ error: "Invalid token scope" });
    }

    const ecUser = await Student.findOne({
      _id: decoded.userId,
      accountRole: ecRoleQuery(),
      sessionVersion: decoded.sessionVersion,
    }).select("-password");
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
