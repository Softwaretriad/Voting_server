import dotenv from "dotenv";
dotenv.config();

export const requirePlan = (req, res, next) => {
  const required = process.env.PLAN_REQUIRED || "basic";
  if (req.user.plan !== required && req.user.plan !== "enterprise") {
    return res.status(403).json({ error: "Active subscription required" });
  }
  next();
};
