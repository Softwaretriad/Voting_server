import School from "../models/school.js";
import { sendError } from "../utils/apiResponse.js";

export const createSchool = async (req, res) => {
  const { name, fullName, shortName, logoUrl, email, plan, faculties = [] } = req.body;

  try {
    const school = await School.create({
      name,
      fullName: fullName || name,
      shortName: shortName || "",
      logoUrl: logoUrl || "",
      email,
      plan,
      faculties,
    });

    res.status(201).json({ message: "School created", schoolId: school._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const checkSubscription = async (req, res) => {
  const { schoolId } = req.params;

  try {
    const school = await School.findById(schoolId);
    if (!school) return res.status(404).json({ error: "School not found" });

    res.json({
      subscriptionActive: school.subscriptionActive,
      plan: school.plan,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getAllSchools = async (_req, res) => {
  try {
    const schools = await School.find({}).select("fullName shortName logoUrl name");

    return res.status(200).json(
      schools.map((school) => ({
        id: school._id.toString(),
        fullName: school.fullName || school.name,
        shortName: school.shortName || "",
        logoUrl: school.logoUrl || "",
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load schools");
  }
};

export const getFacultiesBySchool = async (req, res) => {
  try {
    const school = await School.findById(req.params.schoolId).select("faculties");

    if (!school) {
      return sendError(res, 404, "School not found");
    }

    return res.status(200).json(
      school.faculties.map((faculty) => ({
        id: faculty._id.toString(),
        name: faculty.name,
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load faculties");
  }
};

export const getProgrammesByFaculty = async (req, res) => {
  try {
    const school = await School.findById(req.params.schoolId).select("faculties");

    if (!school) {
      return sendError(res, 404, "School not found");
    }

    const faculty = school.faculties.id(req.params.facultyId);
    if (!faculty) {
      return sendError(res, 404, "Faculty not found");
    }

    return res.status(200).json(
      faculty.programmes.map((programme) => ({
        id: programme._id.toString(),
        name: programme.name,
        durationYears: programme.durationYears ?? 4,
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load programmes");
  }
};
