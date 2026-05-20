import ECUser from "../models/ECUser.js";
import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";
import { verifyToken } from "../utils/studentAuth.js";

export const protectDeleteAccount = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return sendError(res, 401, "Authorization header is required");
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);

    if (decoded.role === "admin") {
      const promotedAdmin = await Student.findOne({
        _id: decoded.userId,
        accountRole: "admin",
      });

      if (promotedAdmin) {
        req.accountStudent = promotedAdmin;
        return next();
      }

      const legacyAdmin = await ECUser.findById(decoded.userId).select("_id");
      if (legacyAdmin) {
        return sendError(
          res,
          403,
          "Legacy admin accounts cannot be deleted through this route"
        );
      }

      return sendError(res, 401, "Admin user not found");
    }

    const student = await Student.findById(decoded.studentId);
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
