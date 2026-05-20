import ECUser from "../models/ECUser.js";
import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";
import { verifyToken } from "../utils/studentAuth.js";

export const protectAnyUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return sendError(res, 401, "Authorization header is required");
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    if (decoded.role === "admin") {
      let admin = await ECUser.findById(decoded.userId).select("-password");
      if (!admin) {
        admin = await Student.findOne({
          _id: decoded.userId,
          accountRole: "admin",
        }).select("-password -votingPin");
      }

      if (!admin) {
        return sendError(res, 401, "Admin user not found");
      }

      req.authUser = {
        recipientType: "admin",
        id: admin._id.toString(),
        schoolId: admin.schoolId?.toString?.() || "",
        document: admin,
      };
      return next();
    }

    const student = await Student.findById(decoded.studentId).select("-password -votingPin");
    if (!student) {
      return sendError(res, 401, "Student not found");
    }

    req.authUser = {
      recipientType: "student",
      id: student._id.toString(),
      schoolId: student.schoolId?.toString?.() || "",
      document: student,
    };
    return next();
  } catch (error) {
    return sendError(res, 401, "Invalid or expired token");
  }
};
