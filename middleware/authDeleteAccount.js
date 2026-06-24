import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";
import { verifyToken } from "../utils/studentAuth.js";
import { ecRoleQuery, isEcRole } from "../utils/ecRole.js";

export const protectDeleteAccount = async (req, res, next) => {
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
      const promotedAdmin = await Student.findOne({
        _id: decoded.userId,
        accountRole: ecRoleQuery(),
        sessionVersion: decoded.sessionVersion,
      });

      if (promotedAdmin) {
        req.accountStudent = promotedAdmin;
        return next();
      }

      return sendError(res, 401, "EC user not found");
    }

    if (decoded.role !== "student") {
      return sendError(res, 401, "Invalid token scope");
    }

    const student = await Student.findOne({
      _id: decoded.studentId,
      sessionVersion: decoded.sessionVersion,
    });
    if (!student) {
      return sendError(res, 401, "Student not found");
    }

    req.accountStudent = student;
    req.student = student;
    return next();
  } catch (error) {
    return sendError(res, 401, "Invalid or expired token");
  }
};
