import jwt from "jsonwebtoken";
import SchoolAdmin from "../models/SchoolAdmin.js";
import { sendError } from "../utils/apiResponse.js";
import {
  getSchoolAdminAccessTokenFromRequest,
  SCHOOL_ADMIN_ROLE,
} from "../utils/schoolAdminAuth.js";

export const protectSchoolAdmin = async (req, res, next) => {
  const token = getSchoolAdminAccessTokenFromRequest(req);

  if (!token) {
    return sendError(res, 401, "School admin authentication required");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== SCHOOL_ADMIN_ROLE || decoded.type !== "access") {
      return sendError(res, 401, "Invalid token scope");
    }

    const schoolAdmin = await SchoolAdmin.findOne({
      _id: decoded.schoolAdminId,
      schoolId: decoded.schoolId,
      isActive: true,
    }).select("-password -refreshToken");

    if (!schoolAdmin) {
      return sendError(res, 401, "School admin not found");
    }

    req.schoolAdmin = schoolAdmin;
    req.schoolId = schoolAdmin.schoolId;
    next();
  } catch {
    return sendError(res, 401, "Invalid or expired school admin token");
  }
};
