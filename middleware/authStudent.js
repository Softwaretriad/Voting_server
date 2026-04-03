import Student from "../models/Student.js";
import { verifyToken } from "../utils/studentAuth.js";
import { sendError } from "../utils/apiResponse.js";

export const protectStudent = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return sendError(res, 401, "Authorization header is required");
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);
    if (decoded.role && decoded.role !== "student") {
      return sendError(res, 401, "Invalid token scope");
    }
    const student = await Student.findById(decoded.studentId);

    if (!student) {
      return sendError(res, 401, "Student not found");
    }

    req.student = student;
    next();
  } catch (error) {
    return sendError(res, 401, "Invalid or expired token");
  }
};
