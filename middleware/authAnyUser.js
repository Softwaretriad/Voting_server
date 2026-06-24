import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";
import { verifyToken } from "../utils/studentAuth.js";
import { EC_ROLE, ecRoleQuery, isEcRole } from "../utils/ecRole.js";

export const protectAnyUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return sendError(res, 401, "Authorization header is required");
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);
    if (decoded.type !== "access") {
      return sendError(res, 401, "Invalid token scope");
    }

    if (isEcRole(decoded.role)) {
      const admin = await Student.findOne({
        _id: decoded.userId,
        accountRole: ecRoleQuery(),
        sessionVersion: decoded.sessionVersion,
      }).select("-password -votingPin");

      if (!admin) {
        return sendError(res, 401, "EC user not found");
      }

      req.authUser = {
        recipientType: EC_ROLE,
        id: admin._id.toString(),
        schoolId: admin.schoolId?.toString?.() || "",
        document: admin,
      };
      return next();
    }

    if (decoded.role !== "student") {
      return sendError(res, 401, "Invalid token scope");
    }

    const student = await Student.findOne({
      _id: decoded.studentId,
      sessionVersion: decoded.sessionVersion,
    }).select("-password -votingPin");
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
