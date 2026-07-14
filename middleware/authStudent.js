import crypto from "crypto";
import Student from "../models/Student.js";
import { verifyToken } from "../utils/studentAuth.js";
import { sendError } from "../utils/apiResponse.js";
import { ecRoleQuery, isEcRole } from "../utils/ecRole.js";

const STUDENT_AUTH_FIELDS =
  "_id studentId firstName lastName gender email phone schoolId accountRole universityFullName department currentYearOfStudy programOfStudy nationality isEmailVerified sessionVersion authProvider votingPin";
const STUDENT_VOTE_AUTH_FIELDS = `${STUDENT_AUTH_FIELDS} votingPin votingPinAttempts votingPinLockedUntil`;
const STUDENT_AUTH_CACHE_TTL_MS = Number(process.env.STUDENT_AUTH_CACHE_TTL_MS || 0);
const STUDENT_AUTH_CACHE_MAX_ENTRIES = Number(process.env.STUDENT_AUTH_CACHE_MAX_ENTRIES || 5000);
const studentAuthCache = new Map();

const getAuthCacheKey = ({ token, fields }) =>
  crypto.createHash("sha256").update(`${fields}:${token}`).digest("hex");

const getCachedStudent = ({ token, fields }) => {
  if (STUDENT_AUTH_CACHE_TTL_MS <= 0) {
    return null;
  }

  const key = getAuthCacheKey({ token, fields });
  const cached = studentAuthCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    studentAuthCache.delete(key);
    return null;
  }

  return cached.student;
};

const cacheStudent = ({ token, fields, student }) => {
  if (STUDENT_AUTH_CACHE_TTL_MS <= 0 || !student) {
    return;
  }

  if (studentAuthCache.size >= STUDENT_AUTH_CACHE_MAX_ENTRIES) {
    const oldestKey = studentAuthCache.keys().next().value;
    if (oldestKey) {
      studentAuthCache.delete(oldestKey);
    }
  }

  studentAuthCache.set(getAuthCacheKey({ token, fields }), {
    student,
    expiresAt: Date.now() + STUDENT_AUTH_CACHE_TTL_MS,
  });
};

const protectStudentWithFields = (fields) => async (req, res, next) => {
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
    let student = getCachedStudent({ token, fields });

    if (student) {
      req.student = student;
      return next();
    }

    if (isEcRole(decoded.role)) {
      student = await Student.findOne({
        _id: decoded.userId,
        accountRole: ecRoleQuery(),
        sessionVersion: decoded.sessionVersion,
      })
        .select(fields)
        .lean();
    } else {
      if (decoded.role && decoded.role !== "student") {
        return sendError(res, 401, "Invalid token scope");
      }
      student = await Student.findOne({
        _id: decoded.studentId,
        sessionVersion: decoded.sessionVersion,
      })
        .select(fields)
        .lean();
    }

    if (!student) {
      return sendError(res, 401, "Student not found");
    }

    cacheStudent({ token, fields, student });
    req.student = student;
    next();
  } catch (error) {
    return sendError(res, 401, "Invalid or expired token");
  }
};

export const protectStudent = protectStudentWithFields(STUDENT_AUTH_FIELDS);
export const protectVotingStudent = protectStudentWithFields(STUDENT_VOTE_AUTH_FIELDS);
