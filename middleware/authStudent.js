import Student from "../models/Student.js";
import { verifyToken } from "../utils/studentAuth.js";
import { sendError } from "../utils/apiResponse.js";
import { ecRoleQuery, isEcRole } from "../utils/ecRole.js";

const STUDENT_AUTH_FIELDS =
  "_id studentId firstName lastName gender email phone schoolId accountRole universityFullName department currentYearOfStudy programOfStudy isEmailVerified";
const STUDENT_VOTE_AUTH_FIELDS = `${STUDENT_AUTH_FIELDS} votingPin votingPinAttempts votingPinLockedUntil`;

const protectStudentWithFields = (fields) => async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return sendError(res, 401, "Authorization header is required");
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = verifyToken(token);
    let student = null;

    if (isEcRole(decoded.role)) {
      student = await Student.findOne({
        _id: decoded.userId,
        accountRole: ecRoleQuery(),
      })
        .select(fields)
        .lean();
    } else {
      if (decoded.role && decoded.role !== "student") {
        return sendError(res, 401, "Invalid token scope");
      }
      student = await Student.findById(decoded.studentId).select(fields).lean();
    }

    if (!student) {
      return sendError(res, 401, "Student not found");
    }

    req.student = student;
    next();
  } catch (error) {
    return sendError(res, 401, "Invalid or expired token");
  }
};

export const protectStudent = protectStudentWithFields(STUDENT_AUTH_FIELDS);
export const protectVotingStudent = protectStudentWithFields(STUDENT_VOTE_AUTH_FIELDS);
