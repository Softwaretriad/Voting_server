import mongoose from "mongoose";
import { readSheet } from "read-excel-file/node";
import PlanUpdateRequest from "../models/PlanUpdateRequest.js";
import School from "../models/school.js";
import SchoolLogoUpload from "../models/SchoolLogoUpload.js";
import SchoolStudentRecord from "../models/SchoolStudentRecord.js";
import Student from "../models/Student.js";
import StudentRegisterImport from "../models/StudentRegisterImport.js";
import { sendError } from "../utils/apiResponse.js";
import {
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
import { ecRoleQuery, STUDENT_ROLE } from "../utils/ecRole.js";

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
const importBulkChunkSize = Math.max(
  100,
  Number(process.env.STUDENT_REGISTER_IMPORT_CHUNK_SIZE || 500)
);

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
    .replace(/[^a-z0-9]/g, "");

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
  const matrix = await readSheet(buffer);
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

const chunkArray = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const STUDENT_REGISTER_FIELDS = {
  studentId: [
    "studentId",
    "student id",
    "student_id",
    "student-id",
    "student number",
    "student no",
    "studentNo",
    "index number",
    "index no",
    "indexNo",
    "matric number",
    "matric no",
    "matricNo",
    "registration number",
    "registration no",
    "reg number",
    "reg no",
    "admission number",
    "admission no",
  ],
  firstName: [
    "firstName",
    "first name",
    "first_name",
    "first-name",
    "givenName",
    "given name",
    "given_name",
    "given-name",
    "forename",
  ],
  lastName: [
    "lastName",
    "last name",
    "last_name",
    "last-name",
    "surname",
    "familyName",
    "family name",
    "family_name",
    "family-name",
  ],
  email: [
    "email",
    "emailAddress",
    "email address",
    "email_address",
    "email-address",
    "studentEmail",
    "student email",
    "schoolEmail",
    "school email",
    "institutionalEmail",
    "institutional email",
  ],
  gender: ["gender", "sex"],
  phone: [
    "phone",
    "phoneNumber",
    "phone number",
    "phone_number",
    "phone-number",
    "mobile",
    "mobileNumber",
    "mobile number",
    "telephone",
    "contact",
    "contactNumber",
    "contact number",
  ],
  faculty: [
    "faculty",
    "facultyName",
    "faculty name",
    "department",
    "departmentName",
    "department name",
  ],
  nationality: ["nationality", "country", "citizenship"],
  programmeOfStudy: [
    "programmeOfStudy",
    "programme of study",
    "programOfStudy",
    "program of study",
    "programme",
    "program",
    "course",
    "courseOfStudy",
    "course of study",
    "major",
    "degreeProgram",
    "degree program",
    "academicProgram",
    "academic program",
  ],
  currentYearOfStudy: [
    "currentYearOfStudy",
    "current year of study",
    "yearOfStudy",
    "year of study",
    "year",
    "level",
    "studentLevel",
    "student level",
  ],
  level: ["level", "studentLevel", "student level", "currentYearOfStudy"],
};

const parseYearOfStudy = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const studentLookupKey = ({ schoolId, studentId }) =>
  `${schoolId?.toString?.() || schoolId}:${studentId}`;

const buildImportedStudentFields = ({
  school,
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
}) => ({
  studentId,
  firstName,
  lastName,
  gender,
  email,
  phone,
  schoolId: school._id,
  universityFullName: school.fullName || school.name,
  department: faculty,
  currentYearOfStudy,
  programOfStudy: programmeOfStudy,
  nationality,
});

const buildImportedStudentInsertFields = (fields) => ({
  ...fields,
  accountRole: STUDENT_ROLE,
  votingPin: null,
  isEmailVerified: false,
  authProvider: "imported",
});

const buildSchoolStudentRecordFields = ({
  schoolId,
  importRecord,
  student,
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
}) => ({
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
  schoolId,
  studentAccountId: student._id,
});

const normalizeStudentRegisterRows = ({ rows, school }) => {
  const normalizedRows = [];
  const skippedRows = [];
  const seenEmails = new Set();
  const seenStudentIds = new Set();

  for (const row of rows) {
    const studentId = getField(row.data, STUDENT_REGISTER_FIELDS.studentId);
    const firstName = getField(row.data, STUDENT_REGISTER_FIELDS.firstName);
    const lastName = getField(row.data, STUDENT_REGISTER_FIELDS.lastName);
    const email = normalizeEmail(getField(row.data, STUDENT_REGISTER_FIELDS.email));
    const gender = getField(row.data, STUDENT_REGISTER_FIELDS.gender).toLowerCase();
    const phone = getField(row.data, STUDENT_REGISTER_FIELDS.phone);
    const faculty = getField(row.data, STUDENT_REGISTER_FIELDS.faculty);
    const nationality = getField(row.data, STUDENT_REGISTER_FIELDS.nationality);
    const programmeOfStudy = getField(
      row.data,
      STUDENT_REGISTER_FIELDS.programmeOfStudy
    );
    const currentYearOfStudy = parseYearOfStudy(
      getField(row.data, STUDENT_REGISTER_FIELDS.currentYearOfStudy)
    );
    const level = getField(row.data, STUDENT_REGISTER_FIELDS.level);

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

    if (seenEmails.has(email) || seenStudentIds.has(studentId)) {
      skippedRows.push({
        rowNumber: row.rowNumber,
        reason: "Duplicate email or studentId in uploaded file",
      });
      continue;
    }

    seenEmails.add(email);
    seenStudentIds.add(studentId);
    normalizedRows.push({
      rowNumber: row.rowNumber,
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
      level,
    });
  }

  return { normalizedRows, skippedRows };
};

const buildStudentImportBulkOperations = async ({
  school,
  importRecord,
  normalizedRows,
  existingByEmail,
  existingByStudentId,
}) => {
  const studentOps = [];
  const schoolStudentRecordOps = [];
  const skippedRows = [];
  let rowsImported = 0;
  let studentAccountsUpserted = 0;

  for (const row of normalizedRows) {
    const existingByEmailMatch = existingByEmail.get(row.email);
    const existingByStudentIdMatch = existingByStudentId.get(
      studentLookupKey({ schoolId: school._id, studentId: row.studentId })
    );
    const student = existingByEmailMatch || existingByStudentIdMatch;

    if (
      existingByEmailMatch &&
      existingByStudentIdMatch &&
      existingByEmailMatch._id.toString() !== existingByStudentIdMatch._id.toString()
    ) {
      skippedRows.push({
        rowNumber: row.rowNumber,
        reason: "Email and studentId belong to different existing accounts",
      });
      continue;
    }

    if (student && student.schoolId?.toString() !== school._id.toString()) {
      skippedRows.push({
        rowNumber: row.rowNumber,
        reason: "Email already belongs to a different school",
      });
      continue;
    }

    const studentId = student?._id || new mongoose.Types.ObjectId();
    const resolvedStudent = { _id: studentId };
    const studentFields = buildImportedStudentFields({
      school,
      ...row,
    });

    if (student) {
      const updateSet = { ...studentFields };
      if (!student.authProvider) {
        updateSet.authProvider = "imported";
      }

      studentOps.push({
        updateOne: {
          filter: { _id: student._id },
          update: { $set: updateSet },
        },
      });
    } else {
      studentOps.push({
        updateOne: {
          filter: { _id: studentId },
          update: {
            $setOnInsert: buildImportedStudentInsertFields(studentFields),
          },
          upsert: true,
        },
      });
    }

    schoolStudentRecordOps.push({
      updateOne: {
        filter: { schoolId: school._id, studentId: row.studentId },
        update: {
          $set: buildSchoolStudentRecordFields({
            schoolId: school._id,
            importRecord,
            student: resolvedStudent,
            ...row,
          }),
        },
        upsert: true,
      },
    });

    rowsImported += 1;
    studentAccountsUpserted += 1;
  }

  return {
    studentOps,
    schoolStudentRecordOps,
    skippedRows,
    rowsImported,
    studentAccountsUpserted,
  };
};

const writeBulkInChunks = async (model, operations) => {
  for (const chunk of chunkArray(operations, importBulkChunkSize)) {
    await model.bulkWrite(chunk, { ordered: false });
  }
};

const processStudentRegisterImport = async ({
  importId,
  schoolId,
  file,
}) => {
  const importRecord = await StudentRegisterImport.findById(importId);
  if (!importRecord) return;

  try {
    importRecord.status = "processing";
    importRecord.startedAt = new Date();
    importRecord.errorMessage = "";
    await importRecord.save();

    const school = await School.findById(schoolId);
    if (!school) {
      const error = new Error("School not found");
      error.statusCode = 404;
      throw error;
    }

    const { headers, rows } = await parseStudentRegisterFile(file);
    const requiredColumnGroups = [
      STUDENT_REGISTER_FIELDS.studentId,
      STUDENT_REGISTER_FIELDS.firstName,
      STUDENT_REGISTER_FIELDS.lastName,
      STUDENT_REGISTER_FIELDS.email,
      STUDENT_REGISTER_FIELDS.gender,
      STUDENT_REGISTER_FIELDS.phone,
      STUDENT_REGISTER_FIELDS.faculty,
      STUDENT_REGISTER_FIELDS.nationality,
      STUDENT_REGISTER_FIELDS.programmeOfStudy,
    ];
    const missingColumns = requiredColumnGroups
      .filter((group) => !hasAnyHeader(headers, group))
      .map((group) => group[0]);
    if (missingColumns.length > 0) {
      const error = new Error(`Missing columns: ${missingColumns.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }

    const { normalizedRows, skippedRows: validationSkippedRows } =
      normalizeStudentRegisterRows({ rows, school });
    const emails = normalizedRows.map((row) => row.email);
    const studentIds = normalizedRows.map((row) => row.studentId);

    const [existingByEmailMatches, existingByStudentIdMatches] = await Promise.all([
      emails.length > 0
        ? Student.find({ email: { $in: emails } })
            .select("_id email schoolId studentId authProvider")
            .lean()
        : Promise.resolve([]),
      studentIds.length > 0
        ? Student.find({ schoolId: school._id, studentId: { $in: studentIds } })
            .select("_id email schoolId studentId authProvider")
            .lean()
        : Promise.resolve([]),
    ]);

    const existingByEmail = new Map(
      existingByEmailMatches.map((student) => [student.email, student])
    );
    const existingByStudentId = new Map(
      existingByStudentIdMatches.map((student) => [
        studentLookupKey({ schoolId: student.schoolId, studentId: student.studentId }),
        student,
      ])
    );

    const {
      studentOps,
      schoolStudentRecordOps,
      skippedRows: conflictSkippedRows,
      rowsImported,
      studentAccountsUpserted,
    } = await buildStudentImportBulkOperations({
      school,
      importRecord,
      normalizedRows,
      existingByEmail,
      existingByStudentId,
    });

    const skippedRows = [...validationSkippedRows, ...conflictSkippedRows];

    if (studentOps.length > 0) {
      await writeBulkInChunks(Student, studentOps);
    }

    if (schoolStudentRecordOps.length > 0) {
      await writeBulkInChunks(SchoolStudentRecord, schoolStudentRecordOps);
    }

    const [studentCount, facultyCount] = await Promise.all([
      Student.countDocuments({ schoolId }),
      Student.distinct("department", { schoolId }).then(
        (faculties) => faculties.filter(Boolean).length
      ),
    ]);

    importRecord.status = "completed";
    importRecord.rowsProcessed = rows.length;
    importRecord.rowsImported = rowsImported;
    importRecord.studentAccountsUpserted = studentAccountsUpserted;
    importRecord.rowsSkipped = skippedRows.length;
    importRecord.requiredColumnsValidated = true;
    importRecord.studentCount = studentCount;
    importRecord.facultyCount = facultyCount;
    importRecord.skippedRows = skippedRows.slice(0, 100);
    importRecord.completedAt = new Date();
    importRecord.failedAt = null;
    importRecord.errorMessage = "";
    await importRecord.save();
  } catch (error) {
    importRecord.status = "failed";
    importRecord.failedAt = new Date();
    importRecord.errorMessage = String(
      error.message || "Failed to import student register"
    ).slice(0, 500);
    await importRecord.save().catch(() => null);
    console.error("Student register import failed:", {
      importId: importId?.toString?.() || importId,
      schoolId: schoolId?.toString?.() || schoolId,
      error: error.message,
    });
  }
};

const queueStudentRegisterImport = (payload) => {
  setImmediate(() => {
    processStudentRegisterImport(payload).catch((error) => {
      console.error("Student register import worker crashed:", error);
    });
  });
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
      logoUploadId,
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

    if (logoUrl !== undefined) {
      return sendError(res, 400, "logoUrl is no longer accepted. Upload a logo first and send logoUploadId.");
    }

    let pendingLogoUpload = null;
    if (logoUploadId !== undefined) {
      pendingLogoUpload = await SchoolLogoUpload.findOne({
        uploadId: String(logoUploadId).trim(),
        consumedAt: null,
      });

      if (!pendingLogoUpload) {
        return sendError(res, 400, "Invalid or expired logoUploadId");
      }

      school.logoUrl = pendingLogoUpload.url;
    }

    if (name !== undefined) school.name = String(name).trim();
    if (fullName !== undefined) school.fullName = String(fullName).trim();
    if (shortName !== undefined) school.shortName = String(shortName).trim();
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
    if (pendingLogoUpload) {
      pendingLogoUpload.consumedAt = new Date();
      await pendingLogoUpload.save();
    }
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
      studentRange: selectedPlan.studentRange,
      voteLimit: selectedPlan.maxVoters,
      subscriptionTerm: school.subscriptionTerm,
      subscriptionTermLabel: selectedTerm.label,
      activationStatus: school.subscriptionActive ? "active" : "inactive",
      isActive: school.subscriptionActive,
      renewalDate: school.subscriptionExpiresAt?.toISOString() || null,
      expiryDate: school.subscriptionExpiresAt?.toISOString() || null,
      registeredStudentCount,
      currentPopulation: registeredStudentCount,
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

    const importRecord = await StudentRegisterImport.create({
      schoolId,
      uploadedBy: req.schoolAdmin._id,
      fileName,
      mimeType: req.file.mimetype || "",
      status: "queued",
    });

    queueStudentRegisterImport({
      importId: importRecord._id,
      schoolId: school._id,
      file: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        buffer: Buffer.from(req.file.buffer),
      },
    });

    return res.status(202).json({
      importId: importRecord._id.toString(),
      schoolId,
      fileName,
      status: importRecord.status,
      uploadedAt: importRecord.createdAt.toISOString(),
      message: "Student register import queued",
    });
  } catch (error) {
    const statusCode =
      Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
    return sendError(
      res,
      statusCode,
      error.message || "Failed to import student register"
    );
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
      Student.countDocuments({ schoolId }),
      Student.distinct("department", { schoolId }).then(
        (faculties) => faculties.filter(Boolean).length
      ),
    ]);

    return res.status(200).json({
      importId: latestImport._id.toString(),
      fileName: latestImport.fileName,
      status: latestImport.status || "completed",
      uploadedAt: latestImport.createdAt.toISOString(),
      startedAt: latestImport.startedAt?.toISOString() || null,
      completedAt: latestImport.completedAt?.toISOString() || null,
      failedAt: latestImport.failedAt?.toISOString() || null,
      errorMessage: latestImport.errorMessage || "",
      studentCount: latestImport.studentCount || studentCount,
      facultyCount: latestImport.facultyCount || facultyCount,
      facultyCoverage: latestImport.facultyCount || facultyCount,
      rowsProcessed: latestImport.rowsProcessed,
      rowsImported: latestImport.rowsImported,
      studentAccountsUpserted: latestImport.studentAccountsUpserted || latestImport.rowsImported,
      rowsSkipped: latestImport.rowsSkipped,
      requiredColumnsValidated: latestImport.requiredColumnsValidated,
      skippedRows: latestImport.skippedRows || [],
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
    const students = await Student.find({
      schoolId,
      $or: [
        { studentId: new RegExp(escaped, "i") },
        { firstName: new RegExp(escaped, "i") },
        { lastName: new RegExp(escaped, "i") },
        { email: new RegExp(escaped, "i") },
        { department: new RegExp(escaped, "i") },
        { nationality: new RegExp(escaped, "i") },
      ],
    })
      .sort({ lastName: 1, firstName: 1 })
      .limit(25)
      .select(
        "_id studentId firstName lastName email department nationality programOfStudy currentYearOfStudy accountRole"
      )
      .lean();

    return res.status(200).json({
      results: students.map((student) => ({
        recordId: null,
        userId: student._id.toString(),
        studentId: student.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        faculty: student.department,
        nationality: student.nationality,
        programmeOfStudy: student.programOfStudy,
        level:
          student.currentYearOfStudy == null
            ? ""
            : String(student.currentYearOfStudy),
        role: student.accountRole || "student",
        hasStudentAccount: true,
      })),
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
