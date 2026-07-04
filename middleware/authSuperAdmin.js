import SuperAdmin from "../models/SuperAdmin.js";
import { sendError } from "../utils/apiResponse.js";
import {
  getSuperAdminAccessTokenFromRequest,
  SUPER_ADMIN_ROLE,
  verifySuperAdminToken,
} from "../utils/superAdminAuth.js";

export const resolveSuperAdminFromRequest = async (req) => {
  const token = getSuperAdminAccessTokenFromRequest(req);
  if (!token) {
    return null;
  }

  try {
    const decoded = verifySuperAdminToken(token);
    if (decoded.role !== SUPER_ADMIN_ROLE || decoded.type !== "access") {
      return null;
    }

    const superAdmin = await SuperAdmin.findOne({
      _id: decoded.superAdminId,
      isActive: true,
      sessionVersion: decoded.sessionVersion,
    }).select("-password -refreshToken");

    if (superAdmin) {
      req.superAdmin = superAdmin;
      req.schoolRegistrationReviewer =
        `${superAdmin.firstName || ""} ${superAdmin.lastName || ""}`.trim() ||
        superAdmin.email ||
        "super_admin";
    }

    return superAdmin;
  } catch {
    return null;
  }
};

export const protectSuperAdmin = async (req, res, next) => {
  const superAdmin = await resolveSuperAdminFromRequest(req);
  if (!superAdmin) {
    return sendError(res, 401, "Super admin authentication required");
  }

  return next();
};
