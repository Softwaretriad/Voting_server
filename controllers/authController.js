import School from "../models/school.js"; // Make sure this is imported

export const registerEC = async (req, res) => {
  try {
    const { name, email, password, plan, schoolId } = req.body;
    if (!email || !password || !plan || !name || !schoolId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const selectedPlan = plans[plan] || plans.basic;

    const existing = await ECUser.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const alreadyInSchool = school.ecMembers.some(ec => ec.email === email);
    if (alreadyInSchool) {
      return res.status(400).json({ error: "EC already part of this school" });
    }
    
    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) {
      return res.status(404).json({ error: "School not found" });
    }

    if (school.ecMembers.length >= 5) {
      return res.status(400).json({ error: "Maximum of 5 EC members allowed" });
    }

    // Create new EC user
    const user = await ECUser.create({
      name,
      email,
      password,
      plan,
      maxVoters: selectedPlan.maxVoters,
      schoolId
    });

    // Link EC to school
    school.ecMembers.push(user._id);
    await school.save();

    res.status(201).json({ message: "EC registered and added to school", user });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};
