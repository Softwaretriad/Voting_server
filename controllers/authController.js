import School from "../models/school.js";
import Student from "../models/Student.js";
import { recordActivity } from "../utils/activityLog.js";
import { notifyAdmin, notifySchoolAdmins } from "../utils/notificationService.js";
import { normalizeEmail } from "../utils/security.js";
import { EC_ROLE, ecRoleQuery, isEcAccountRole } from "../utils/ecRole.js";

const MAX_EC_MEMBERS_PER_SCHOOL = 5;

export const promoteSchoolAdmins = async (req, res) => {
  try {
    const { members = [] } = req.body || {};
    const { schoolId } = req.params;

    if (req.schoolAdmin && req.schoolAdmin.schoolId?.toString() !== schoolId) {
      return res.status(403).json({ error: "You are not allowed to manage this school" });
    }

    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: "members must be a non-empty array" });
    }

    const school = await School.findById(schoolId).select("name fullName");
    if (!school) {
      return res.status(404).json({ error: "School not found" });
    }

    const normalizedMembers = Array.from(
      new Map(
        members
          .map((member) => ({
            studentId: String(member?.studentId || "").trim(),
            email: normalizeEmail(member?.email),
          }))
          .filter((member) => member.studentId && member.email)
          .map((member) => [`${member.studentId}:${member.email}`, member])
      ).values()
    );

    if (normalizedMembers.length === 0) {
      return res.status(400).json({
        error: "Each member must include a valid studentId and email",
      });
    }

    const ecCount = await Student.countDocuments({
      schoolId: school._id,
      accountRole: ecRoleQuery(),
    });
    const promotedCount = await Student.countDocuments({
      schoolId: school._id,
      accountRole: "student",
      $or: normalizedMembers.map((member) => ({
        studentId: member.studentId,
        email: member.email,
      })),
    });

    if (ecCount + promotedCount > MAX_EC_MEMBERS_PER_SCHOOL) {
      return res.status(400).json({
        error: `A school can have at most ${MAX_EC_MEMBERS_PER_SCHOOL} EC members.`,
      });
    }

    const students = await Student.find({
      schoolId: school._id,
      $or: normalizedMembers.map((member) => ({
        studentId: member.studentId,
        email: member.email,
      })),
    }).select("studentId email firstName lastName accountRole schoolId");

    const studentByKey = new Map(
      students.map((student) => [
        `${String(student.studentId || "").trim()}:${normalizeEmail(student.email)}`,
        student,
      ])
    );

    const assigned = [];
    const skipped = [];

    for (const member of normalizedMembers) {
      const key = `${member.studentId}:${member.email}`;
      const student = studentByKey.get(key);

      if (!student) {
        skipped.push({
          studentId: member.studentId,
          email: member.email,
          reason: "Student account not found for this school",
        });
        continue;
      }

      if (isEcAccountRole(student.accountRole)) {
        skipped.push({
          studentId: member.studentId,
          email: member.email,
          reason: "Student is already an EC member",
        });
        continue;
      }

      student.accountRole = EC_ROLE;
      student.ecAssignedAt = new Date();
      student.ecAssignedBy = null;
      student.refreshToken = null;
      student.sessionVersion = Number(student.sessionVersion || 0) + 1;
      await student.save();

      await notifyAdmin({
        ecUserId: student._id,
        schoolId: student.schoolId,
        type: "ec_member_added",
        title: "EC access activated",
        message:
          "You have been promoted to EC. Please log out and log back in to access the EC view.",
        priority: "normal",
      });

      assigned.push({
        ecUserId: student._id.toString(),
        studentId: student.studentId,
        email: student.email,
        firstName: student.firstName,
        lastName: student.lastName,
        role: student.accountRole,
      });
    }

    if (assigned.length > 0) {
      await recordActivity({
        actorType: "system",
        actorId: null,
        schoolId: school._id,
        action: "EC Members Assigned By School Bootstrap",
        metadata: {
          assignedStudentIds: assigned.map((item) => item.studentId),
          assignedEmails: assigned.map((item) => item.email),
          skippedStudentIds: skipped.map((item) => item.studentId),
          promotionAuthMode: req.schoolAdmin ? "school_admin_cookie" : "school_id_bootstrap",
          schoolAdminId: req.schoolAdmin?._id?.toString?.() || null,
        },
      });
      await notifySchoolAdmins({
        schoolId: school._id,
        type: "ec_member_added",
        title: "EC members promoted",
        message: `${assigned.length} EC member(s) were promoted for ${school.fullName || school.name}.`,
        priority: "normal",
        data: {
          assignedStudentIds: assigned.map((item) => item.studentId),
          assignedEmails: assigned.map((item) => item.email),
        },
      });
    }

    return res.status(201).json({
      message: "EC promotions processed",
      assigned,
      skipped,
      maxEcMembersPerSchool: MAX_EC_MEMBERS_PER_SCHOOL,
    });
  } catch (err) {
    console.error("EC PROMOTION ERROR:", err);
    return res.status(500).json({
      error: err.message || "Failed to promote EC members",
    });
  }
};
