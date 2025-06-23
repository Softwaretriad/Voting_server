import dotenv from "dotenv";
import School from "../models/school.js";
dotenv.config();

export const requirePlan = async (req, res, next) => {
  try {
    const school = await School.findById(req.schoolId);
    if (!school) {
      return res.status(404).json({ error: "School not found" });
    }

    if (!school.subscriptionActive) {
      return res.status(403).json({ error: "Active subscription required" });
    }

    // Optional: check for minimum plan level
    const requiredPlan = process.env.PLAN_REQUIRED || "basic";
    const planRank = { basic: 1, standard: 2, premium: 3 };
    const schoolRank = planRank[school.plan];
    const requiredRank = planRank[requiredPlan];

    if (schoolRank < requiredRank) {
      return res.status(403).json({ error: `Minimum plan: ${requiredPlan}` });
    }

    req.school = school; // attach for later use
    next();
  } catch (err) {
    res.status(500).json({ error: "Subscription validation failed" });
  }
};
