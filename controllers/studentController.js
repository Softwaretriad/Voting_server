import Student from "../models/Student.js";
import { sanitizeStudentProfile, sendError } from "../utils/apiResponse.js";

export const getStudentProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const student = await Student.findById(userId);

    if (!student) {
      return sendError(res, 404, "Student not found");
    }

    if (req.student._id.toString() !== userId) {
      return sendError(res, 403, "You are not allowed to access this profile");
    }

    return res.status(200).json(sanitizeStudentProfile(student));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load student profile");
  }
};
