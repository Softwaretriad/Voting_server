import dotenv from "dotenv";
import School from "../models/school.js";
import { syncSchoolSubscriptionState } from "../utils/plans.js";
dotenv.config();

export const requirePlan = async (req, res, next) => {
  try {
    const school = await School.findById(req.schoolId);
    if (!school) {
      return res.status(404).json({ error: "School not found" });
    }

    syncSchoolSubscriptionState(school);
    await school.save();

    if (!school.subscriptionActive) {
      return res.status(403).json({ error: "Active subscription required" });
    }

    req.school = school; // attach for later use
    next();
  } catch (err) {
    res.status(500).json({ error: "Subscription validation failed" });
  }
};
