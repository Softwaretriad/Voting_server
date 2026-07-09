import School from "../models/school.js";
import Student from "../models/Student.js";
import { normalizeEmail } from "../utils/security.js";
import { notifySchoolAdmins } from "../utils/notificationService.js";
import { ecRoleQuery } from "../utils/ecRole.js";

const MAX_EC_MEMBERS_PER_SCHOOL = 5;

export const addECMember = async (_req, res) =>
  res.status(410).json({
    error:
      "Direct EC creation has been retired. Promote an existing student account instead.",
  });

export const listECMembers = async (req, res) => {
  const { schoolId } = req.params;

  try {
    if (req.schoolId && req.schoolId.toString() !== schoolId?.toString()) {
      return res.status(403).json({ error: "You are not allowed to access this school" });
    }

    const school = await School.findById(schoolId).select("_id");
    if (!school) return res.status(404).json({ error: "School not found" });

    const studentAdmins = await Student.find({
      schoolId,
      accountRole: ecRoleQuery(),
    }).select(
      "studentId firstName lastName email department nationality schoolId accountRole createdAt updatedAt ecAssignedAt"
    );

    return res.json({
      maxEcMembersPerSchool: MAX_EC_MEMBERS_PER_SCHOOL,
      totalEcMembers: studentAdmins.length,
      assignedEcMembers: studentAdmins.map((student) => ({
        id: student._id.toString(),
        _id: student._id.toString(),
        studentId: student.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        name: `${student.firstName || ""} ${student.lastName || ""}`.trim(),
        email: student.email,
        faculty: student.department || "",
        nationality: student.nationality || "",
        accountRole: student.accountRole,
        ecAssignedAt: student.ecAssignedAt,
      })),
      members: studentAdmins.map((student) => ({
        id: student._id.toString(),
        _id: student._id,
        studentId: student.studentId,
        firstName: student.firstName,
        lastName: student.lastName,
        name: `${student.firstName || ""} ${student.lastName || ""}`.trim(),
        email: student.email,
        faculty: student.department || "",
        nationality: student.nationality || "",
        schoolId: student.schoolId,
        accountRole: student.accountRole,
        accountType: "student_ec",
        ecAssignedAt: student.ecAssignedAt,
        createdAt: student.createdAt,
        updatedAt: student.updatedAt,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const removeECMember = async (req, res) => {
  const { ecId } = req.params;
  const schoolId = req.schoolId;

  try {
    const studentAdmin = await Student.findOne({
      _id: ecId,
      schoolId,
      accountRole: ecRoleQuery(),
    });
    if (!studentAdmin) {
      return res.status(404).json({ error: "EC member not found" });
    }

    studentAdmin.accountRole = "student";
    studentAdmin.ecAssignedAt = null;
    studentAdmin.ecAssignedBy = null;
    studentAdmin.refreshToken = null;
    studentAdmin.sessionVersion = Number(studentAdmin.sessionVersion || 0) + 1;
    await studentAdmin.save();

    await notifySchoolAdmins({
      schoolId,
      type: "ec_member_removed",
      title: "EC member removed",
      message: `${studentAdmin.firstName} ${studentAdmin.lastName} was removed from EC.`,
      priority: "normal",
      data: {
        ecUserId: ecId,
        studentId: studentAdmin.studentId,
        email: normalizeEmail(studentAdmin.email),
      },
      excludeEcUserIds: [ecId],
    });

    return res.json({ message: "EC member removed" });
  } catch (err) {
    console.error("Remove EC member error:", err);
    return res.status(500).json({ error: err.message });
  }
};
