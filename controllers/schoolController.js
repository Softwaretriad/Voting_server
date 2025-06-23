import School from "../models/school.js";

/** Create a school + subscription  */
export const createSchool = async (req, res) => {
  const { name, email, plan } = req.body;
  try {
    const school = await School.create({ name, email, plan });
    res.status(201).json({ message: "School created", schoolId: school._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


/** Check subscription status */
export const checkSubscription = async (req, res) => {
  const { schoolId } = req.params;
  try {
    const school = await School.findById(schoolId);
    if (!school) return res.status(404).json({ error: "School not found" });
    res.json({
      subscriptionActive: school.subscriptionActive,
      plan: school.plan
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
