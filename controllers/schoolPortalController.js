import mongoose from "mongoose";
import readXlsxFile from "read-excel-file/node";
import PlanUpdateRequest from "../models/PlanUpdateRequest.js";
import School from "../models/school.js";
import SchoolStudentRecord from "../models/SchoolStudentRecord.js";
import Student from "../models/Student.js";
import StudentRegisterImport from "../models/StudentRegisterImport.js";
import { sendError } from "../utils/apiResponse.js";
import {
  createOpaqueToken,
  isValidEmail,
  normalizeEmail,
} from "../utils/security.js";
import {
  calculateSubscriptionExpiry,
  getPlanConfig,
  getSubscriptionTermConfig,
  subscriptionTerms,
  syncSchoolSubscriptionState,
} from "../utils/plans.js";
import {
  emailMatchesAllowedDomains,
  isValidEmailDomain,
  normalizeAllowedEmailDomains,
} from "../utils/emailDomains.js";
import { ecRoleQuery } from "../utils/ecRole.js";

const ensureSchoolAdminAccess = (req, res, schoolId) => {
  if (req.schoolAdmin?.schoolId?.toString() !== schoolId?.toString()) {
    sendError(res, 403, "You are not allowed to access this school");
    return false;
  }

  return true;
};

const isSupportedSubscriptionTerm = (term) =>
  Boolean(subscriptionTerms[String(term || "").trim()]);

const supportedPlans = new Set(["free", "micro", "small", "medium", "large", "enterprise"]);
const isSupportedPlan = (plan) => supportedPlans.has(String(plan || "").trim());

const sanitizeSchoolProfile = (school) => ({
  schoolId: school._id.toString(),
  name: school.name,
  fullName: school.fullName || school.name,
  shortName: school.shortName || "",
  email: school.email,
  logoUrl: school.logoUrl || "",
  allowedEmailDomains: school.allowedEmailDomains || [],
  registrationStatus: school.registrationStatus || "approved",
  faculties: (school.faculties || []).map((faculty) => ({
    facultyId: faculty._id.toString(),
    name: faculty.name,
    programmes: (faculty.programmes || []).map((programme) => ({
      programmeId: programme._id.toString(),
      name: programme.name,
      durationYears: programme.durationYears ?? 4,
    })),
  })),
  documentStatus: {
    officialDocuments: (school.officialDocuments || []).length,
    verificationStatus: school.registrationStatus || "approved",
  },
});

const parseCsvLine = (line) => {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
};

const normalizeHeader = (header) =>
  String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

const parseCsv = (buffer) => {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const rows = lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    return {
      rowNumber: index + 2,
      data: headers.reduce((acc, header, headerIndex) => {
        acc[header] = values[headerIndex] || "";
        return acc;
      }, {}),
    };
  });

  return { headers, rows };
};

const parseSpreadsheet = async (buffer) => {
  const matrix = await readXlsxFile(buffer);
  if (matrix.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = matrix[0].map(normalizeHeader);
  const rows = matrix.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    data: headers.reduce((acc, header, headerIndex) => {
      acc[header] = values[headerIndex] || "";
      return acc;
    }, {}),
  }));

  return { headers, rows };
};

const parseStudentRegisterFile = async (file) => {
  const fileName = file.originalname || "";
  if (/\.csv$/i.test(fileName)) {
    return parseCsv(file.buffer);
  }

  if (/\.xlsx$/i.test(fileName)) {
    return parseSpreadsheet(file.buffer);
  }

  if (/\.xls$/i.test(fileName)) {
    const error = new Error("Legacy .xls files are not supported. Please save the register as .xlsx or .csv.");
    error.statusCode = 400;
    throw error;
  }

  const error = new Error("registerFile must be a .csv or .xlsx file");
  error.statusCode = 400;
  throw error;
};

const getField = (row, names) => {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value) return String(value).trim();
  }
  return "";
};

const hasAnyHeader = (headers, names) =>
  names.some((name) => headers.includes(normalizeHeader(name)));

const parseYearOfStudy = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const createImportedAccountPassword = () =>
  `oauth-only-${createOpaqueToken()}`;

const upsertImportedStudentAccount = async ({
  school,
  importRecord,
  studentId,
  firstName,
  lastName,
  email,
  gender,
  phone,
  faculty,
  nationality,
  programmeOfStudy,
  currentYearOfStudy,
}) => {
  const existingByEmail = await Student.findOne({ email });
  const existingByStudentId = await Student.findOne({ schoolId: school._id, studentId });
  const student = existingByEmail || existingByStudentId;

  if (existingByEmail && existingByStudentId && existingByEmail._id.toString() !== existingByStudentId._id.toString()) {
    return {
      error: "Email and studentId belong to different existing accounts",
    };
  }

  if (student && student.schoolId?.toString() !== school._id.toString()) {
    return {
      error: "Email already belongs to a different school",
    };
  }

  if (student) {
    student.studentId = studentId;
    student.firstName = firstName;
    student.lastName = lastName;
    student.gender = gender;
    student.email = email;
    student.phone = phone;
    student.schoolId = school._id;
    student.universityFullName = school.fullName || school.name;
    student.department = faculty;
    student.currentYearOfStudy = currentYearOfStudy;
    student.programOfStudy = programmeOfStudy;
    student.nationality = nationality;
    if (!student.authProvider || student.authProvider === "password") {
      student.authProvider = student.passwordLoginEnabled === false ? "imported" : student.authProvider;
    }
    await student.save();
    return { student };
  }

  const createdStudent = await Student.create({
    studentId,
    firstName,
    lastName,
    gender,
    email,
    password: createImportedAccountPassword(),
    passwordLoginEnabled: false,
    phone,
    schoolId: school._id,
    universityFullName: school.fullName || school.name,
    department: faculty,
    currentYearOfStudy,
    programOfStudy: programmeOfStudy,
    nationality,
    votingPin: null,
    isEmailVerified: false,
    authProvider: "imported",
  });

  return { student: createdStudent };
};

export const getSchoolProfile = async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!ensureSchoolAdminAccess(req, res, schoolId)) return;

    const school = await School.findById(schoolId);
    if (!school) {
      return sendError(res, 404, "School not found");
    }

    return res.status(200).json(sanitizeSchoolProfile(school));
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load school profile");
  }
};

export const updateSchoolProfile = async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!ensureSchoolAdminAccess(req, res, schoolId)) return;

    const school = await School.findById(schoolId);
    if (!school) {
      return sendError(res, 404, "School not found");
    }

    if (school.registrationStatus && school.registrationStatus !== "approved") {
      return sendError(res, 403, "Only approved schools can update setup");
    }

    const {
      name,
      fullName,
      shortName,
      email,
      logoUrl,
      allowedEmailDomains,
      allowedDomains,
      faculties,
    } = req.body || {};

    const domains =
      allowedEmailDomains !== undefined ? allowedEmailDomains : allowedDomains;
    if (domains !== undefined) {
      const normalizedDomains = normalizeAllowedEmailDomains(domains);
      if (normalizedDomains.length === 0) {
        return sendError(res, 400, "allowedEmailDomains must include at least one domain");
      }
      const invalidDomain = normalizedDomains.find((domain) => !isValidEmailDomain(domain));
      if (invalidDomain) {
        return sendError(res, 400, `Invalid allowed email domain: ${invalidDomain}`);
      }
      school.allowedEmailDomains = normalizedDomains;
    }

    if (email !== undefined) {
      if (!isValidEmail(email)) {
        return sendError(res, 400, "email must be a valid email address");
      }
      school.email = normalizeEmail(email);
    }

    if (name !== undefined) school.name = String(name).trim();
    if (fullName !== undefined) school.fullName = String(fullName).trim();
    if (shortName !== undefined) school.shortName = String(shortName).trim();
    if (logoUrl !== undefined) school.logoUrl = String(logoUrl).trim();
    if (faculties !== undefined) {
      if (!Array.isArray(faculties)) {
        return sendError(res, 400, "faculties must be an array");
      }
      school.faculties = faculties.map((faculty) => ({
        name: String(faculty.name || "").trim(),
        programmes: Array.isArray(faculty.programmes)
          ? faculty.programmes.map((programme) => ({
              name: String(programme.name || "").trim(),
              durationYears: Number(programme.durationYears || 4),
            }))
          : [],
      }));
    }

    await school.save();
    return res.status(200).json(sanitizeSchoolProfile(school));
  } catch (error) {
    if (error.code === 11000) {
      return sendError(res, 409, "A school with this email already exists");
    }
    return sendError(res, 500, error.message || "Failed to update school profile");
  }
};

export const getAssignedPlan = async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!ensureSchoolAdminAccess(req, res, schoolId)) return;

    const [school, registeredStudentCount] = await Promise.all([
      School.findById(schoolId),
      Student.countDocuments({ schoolId }),
    ]);

    if (!school) {
      return sendError(res, 404, "School not found");
    }

    syncSchoolSubscriptionState(school);
    const selectedPlan = getPlanConfig(school.plan);
    const selectedTerm = getSubscriptionTermConfig(school.subscriptionTerm);

    return res.status(200).json({
      plan: school.plan,
      planName: selectedPlan.name,
      populationRangeLabel: selectedPlan.studentRange,
      voteLimit: selectedPlan.maxVoters,
      subscriptionTerm: school.subscriptionTerm,
      subscriptionTermLabel: selectedTerm.label,
      activationStatus: school.subscriptionActive ? "active" : "inactive",
      renewalDate: school.subscriptionExpiresAt?.toISOString() || null,
      registeredStudentCount,
      commercialMode: "private_contract",
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load assigned plan");
  }
};

export const createPlanUpdateRequest = async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!ensureSchoolAdminAccess(req, res, schoolId)) return;

    const { targetPlan, targetElectionType } = req.body || {};
    const school = await School.findById(schoolId);
    if (!school) {
      return sendError(res, 404, "School not found");
    }

    if (!isSupportedPlan(targetPlan)) {
      return sendError(res, 400, "targetPlan must be a supported plan");
    }

    if (!isSupportedSubscriptionTerm(targetElectionType)) {
      return sendError(res, 400, "targetElectionType must be one_off_election, 4_months, or 1_year");
    }

    if (school.plan === targetPlan && school.subscriptionTerm === targetElectionType) {
      return sendError(res, 409, "Target plan must differ from current plan or election type");
    }

    const request = await PlanUpdateRequest.create({
      schoolId,
      requestedBy: req.schoolAdmin._id,
      currentPlan: school.plan,
      targetPlan,
      currentElectionType: school.subscriptionTerm,
      targetElectionType,
    });

    return res.status(201).json({
      message: "Plan update request submitted",
      requestId: request._id.toString(),
      schoolId,
      currentPlan: request.currentPlan,
      targetPlan: request.targetPlan,
      currentElectionType: request.currentElectionType,
      targetElectionType: request.targetElectionType,
      status: request.status,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to create plan update request");
  }
};

export const importStudentRegister = async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!ensureSchoolAdminAccess(req, res, schoolId)) return;

    if (!req.file) {
      return sendError(res, 400, "registerFile is required");
    }

    const school = await School.findById(schoolId);
    if (!school) {
      return sendError(res, 404, "School not found");
    }

    const fileName = req.file.originalname || "student-register";

    const { headers, rows } = await parseStudentRegisterFile(req.file);
    const requiredColumnGroups = [
      ["studentId"],
      ["firstName"],
      ["lastName"],
      ["email"],
      ["gender"],
      ["phone", "phoneNumber"],
      ["faculty", "department"],
      ["nationality"],
      ["programmeOfStudy", "programOfStudy", "programme", "program"],
    ];
    const missingColumns = requiredColumnGroups
      .filter((group) => !hasAnyHeader(headers, group))
      .map((group) => group.join(" or "));
    if (missingColumns.length > 0) {
      return sendError(res, 400, `Missing columns: ${missingColumns.join(", ")}`);
    }

    const importRecord = await StudentRegisterImport.create({
      schoolId,
      uploadedBy: req.schoolAdmin._id,
      fileName,
      mimeType: req.file.mimetype || "",
      rowsProcessed: rows.length,
      requiredColumnsValidated: true,
    });

    const skippedRows = [];
    let rowsImported = 0;
    let studentAccountsUpserted = 0;
    for (const row of rows) {
      const studentId = getField(row.data, ["studentId"]);
      const firstName = getField(row.data, ["firstName"]);
      const lastName = getField(row.data, ["lastName"]);
      const email = normalizeEmail(getField(row.data, ["email"]));
      const gender = getField(row.data, ["gender"]).toLowerCase();
      const phone = getField(row.data, ["phone", "phoneNumber"]);
      const faculty = getField(row.data, ["faculty", "department"]);
      const nationality = getField(row.data, ["nationality"]);
      const programmeOfStudy = getField(row.data, [
        "programmeOfStudy",
        "programOfStudy",
        "programme",
        "program",
      ]);
      const currentYearOfStudy = parseYearOfStudy(
        getField(row.data, ["currentYearOfStudy", "yearOfStudy", "year", "level"])
      );
      const level = getField(row.data, ["level", "currentYearOfStudy"]);

      if (
        !studentId ||
        !firstName ||
        !lastName ||
        !isValidEmail(email) ||
        !["male", "female"].includes(gender) ||
        !phone ||
        !faculty ||
        !nationality ||
        !programmeOfStudy
      ) {
        skippedRows.push({
          rowNumber: row.rowNumber,
          reason: "Missing required data, invalid email, or invalid gender",
        });
        continue;
      }

      if (!emailMatchesAllowedDomains(email, school.allowedEmailDomains)) {
        skippedRows.push({
          rowNumber: row.rowNumber,
          reason: "Email does not match this school's allowed domains",
        });
        continue;
      }

      const { student, error } = await upsertImportedStudentAccount({
        school,
        importRecord,
        studentId,
        firstName,
        lastName,
        email,
        gender,
        phone,
        faculty,
        nationality,
        programmeOfStudy,
        currentYearOfStudy,
      });
      if (error) {
        skippedRows.push({
          rowNumber: row.rowNumber,
          reason: error,
        });
        continue;
      }

      await SchoolStudentRecord.updateOne(
        { schoolId, studentId },
        {
          $set: {
            latestImportId: importRecord._id,
            studentId,
            firstName,
            lastName,
            email,
            gender,
            phone,
            faculty,
            nationality,
            programmeOfStudy,
            level,
            currentYearOfStudy,
            studentAccountId: student._id,
          },
        },
        { upsert: true }
      );
      rowsImported += 1;
      studentAccountsUpserted += 1;
    }

    importRecord.rowsImported = rowsImported;
    importRecord.studentAccountsUpserted = studentAccountsUpserted;
    importRecord.rowsSkipped = skippedRows.length;
    importRecord.skippedRows = skippedRows.slice(0, 100);
    await importRecord.save();

    return res.status(201).json({
      importId: importRecord._id.toString(),
      schoolId,
      fileName,
      rowsProcessed: importRecord.rowsProcessed,
      rowsImported,
      studentAccountsUpserted,
      rowsSkipped: skippedRows.length,
      requiredColumnsValidated: true,
      importedAt: importRecord.createdAt.toISOString(),
      skippedRows: importRecord.skippedRows,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to import student register");
  }
};

export const getLatestStudentRegisterImport = async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!ensureSchoolAdminAccess(req, res, schoolId)) return;

    const latestImport = await StudentRegisterImport.findOne({ schoolId }).sort({
      createdAt: -1,
    });
    if (!latestImport) {
      return res.status(200).json(null);
    }

    const [studentCount, facultyCount] = await Promise.all([
      SchoolStudentRecord.countDocuments({ schoolId }),
      SchoolStudentRecord.distinct("faculty", { schoolId }).then((faculties) => faculties.length),
    ]);

    return res.status(200).json({
      importId: latestImport._id.toString(),
      fileName: latestImport.fileName,
      uploadedAt: latestImport.createdAt.toISOString(),
      studentCount,
      facultyCount,
      rowsProcessed: latestImport.rowsProcessed,
      rowsImported: latestImport.rowsImported,
      studentAccountsUpserted: latestImport.studentAccountsUpserted || latestImport.rowsImported,
      rowsSkipped: latestImport.rowsSkipped,
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load latest import");
  }
};

export const searchRegisteredStudents = async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!ensureSchoolAdminAccess(req, res, schoolId)) return;

    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      return sendError(res, 400, "q must be at least 2 characters");
    }

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const records = await SchoolStudentRecord.find({
      schoolId,
      $or: [
        { studentId: new RegExp(escaped, "i") },
        { firstName: new RegExp(escaped, "i") },
        { lastName: new RegExp(escaped, "i") },
        { email: new RegExp(escaped, "i") },
      ],
    })
      .sort({ lastName: 1, firstName: 1 })
      .limit(25);

    const studentIds = records.map((record) => record.studentId);
    const emails = records.map((record) => record.email);
    const accounts = await Student.find({
      schoolId,
      $or: [{ studentId: { $in: studentIds } }, { email: { $in: emails } }],
    }).select("_id studentId email accountRole");
    const accountByStudentId = new Map(
      accounts.map((account) => [account.studentId, account])
    );
    const accountByEmail = new Map(accounts.map((account) => [account.email, account]));

    return res.status(200).json({
      results: records.map((record) => {
        const account =
          accountByStudentId.get(record.studentId) || accountByEmail.get(record.email);
        return {
          recordId: record._id.toString(),
          userId: account?._id?.toString() || null,
          studentId: record.studentId,
          firstName: record.firstName,
          lastName: record.lastName,
          email: record.email,
          faculty: record.faculty,
          nationality: record.nationality,
          programmeOfStudy: record.programmeOfStudy,
          level: record.level,
          role: account?.accountRole || "registered_student",
          hasStudentAccount: Boolean(account),
        };
      }),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to search students");
  }
};

export const assignSchoolPlanBySuperAdmin = async (req, res) => {
  try {
    const { schoolId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(schoolId)) {
      return sendError(res, 400, "Invalid schoolId");
    }

    const { plan, subscriptionTerm, subscriptionStartedAt } = req.body || {};
    if (!isSupportedPlan(plan)) {
      return sendError(res, 400, "plan must be a supported plan");
    }
    if (!isSupportedSubscriptionTerm(subscriptionTerm)) {
      return sendError(res, 400, "subscriptionTerm must be one_off_election, 4_months, or 1_year");
    }

    const school = await School.findById(schoolId);
    if (!school) {
      return sendError(res, 404, "School not found");
    }

    const startedAt = subscriptionStartedAt ? new Date(subscriptionStartedAt) : new Date();
    if (Number.isNaN(startedAt.getTime())) {
      return sendError(res, 400, "subscriptionStartedAt must be a valid ISO datetime");
    }

    school.plan = plan;
    school.subscriptionTerm = subscriptionTerm;
    school.subscriptionStartedAt = startedAt;
    school.subscriptionExpiresAt = calculateSubscriptionExpiry({
      subscriptionTerm,
      startedAt,
    });
    school.subscriptionActive = school.registrationStatus === "approved";
    school.oneOffElectionConsumed = false;
    await school.save();

    return res.status(200).json({
      schoolId: school._id.toString(),
      plan: school.plan,
      subscriptionTerm: school.subscriptionTerm,
      subscriptionStartedAt: school.subscriptionStartedAt.toISOString(),
      subscriptionExpiresAt: school.subscriptionExpiresAt?.toISOString() || null,
      subscriptionActive: school.subscriptionActive,
      assignedBy: req.superAdmin?.email || "super_admin",
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to assign school plan");
  }
};

export const listPlanUpdateRequestsForSuperAdmin = async (req, res) => {
  try {
    const status = String(req.query.status || "pending_review").trim();
    const allowedStatuses = new Set(["pending_review", "approved", "rejected", "closed"]);
    if (!allowedStatuses.has(status)) {
      return sendError(res, 400, "status must be pending_review, approved, rejected, or closed");
    }

    const requests = await PlanUpdateRequest.find({ status })
      .sort({ createdAt: -1 })
      .limit(250)
      .populate("schoolId", "name fullName shortName email plan subscriptionTerm")
      .populate("requestedBy", "firstName lastName email");

    return res.status(200).json(
      requests.map((request) => ({
        requestId: request._id.toString(),
        school: request.schoolId
          ? {
              schoolId: request.schoolId._id.toString(),
              name: request.schoolId.name,
              fullName: request.schoolId.fullName || request.schoolId.name,
              shortName: request.schoolId.shortName || "",
              email: request.schoolId.email,
            }
          : null,
        requestedBy: request.requestedBy
          ? {
              name: `${request.requestedBy.firstName || ""} ${request.requestedBy.lastName || ""}`.trim(),
              email: request.requestedBy.email,
            }
          : null,
        currentPlan: request.currentPlan,
        targetPlan: request.targetPlan,
        currentElectionType: request.currentElectionType,
        targetElectionType: request.targetElectionType,
        status: request.status,
        createdAt: request.createdAt.toISOString(),
        reviewedAt: request.reviewedAt?.toISOString() || null,
        reviewedBy: request.reviewedBy,
        reviewNote: request.reviewNote,
      }))
    );
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to load plan update requests");
  }
};

export const reviewPlanUpdateRequestBySuperAdmin = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { status, reviewNote = "", applyPlan = false } = req.body || {};
    if (!["approved", "rejected", "closed"].includes(status)) {
      return sendError(res, 400, "status must be approved, rejected, or closed");
    }

    const request = await PlanUpdateRequest.findById(requestId);
    if (!request) {
      return sendError(res, 404, "Plan update request not found");
    }

    request.status = status;
    request.reviewedAt = new Date();
    request.reviewedBy =
      `${req.superAdmin?.firstName || ""} ${req.superAdmin?.lastName || ""}`.trim() ||
      req.superAdmin?.email ||
      "super_admin";
    request.reviewNote = String(reviewNote || "").trim();
    await request.save();

    if (status === "approved" && applyPlan) {
      const school = await School.findById(request.schoolId);
      if (school) {
        const startedAt = new Date();
        school.plan = request.targetPlan;
        school.subscriptionTerm = request.targetElectionType;
        school.subscriptionStartedAt = startedAt;
        school.subscriptionExpiresAt = calculateSubscriptionExpiry({
          subscriptionTerm: request.targetElectionType,
          startedAt,
        });
        school.subscriptionActive = school.registrationStatus === "approved";
        school.oneOffElectionConsumed = false;
        await school.save();
      }
    }

    return res.status(200).json({
      requestId: request._id.toString(),
      status: request.status,
      reviewedAt: request.reviewedAt.toISOString(),
      reviewedBy: request.reviewedBy,
      applyPlan: Boolean(applyPlan),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to review plan update request");
  }
};
