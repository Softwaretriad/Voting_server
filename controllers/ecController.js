import School from "../models/school.js";
import ECUser from "../models/ECUser.js";
import Student from "../models/Student.js";
import { normalizeEmail } from "../utils/security.js";
import { notifySchoolAdmins } from "../utils/notificationService.js";

export const addECMember = async (req, res) => {
  const { schoolId, name, email, password } = req.body;

  try {
    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) return res.status(404).json({ error: "School not found" });

    if (school.ecMembers.length >= 5) {
      return res.status(400).json({ error: "Maximum 5 EC members allowed" });
    }

    const normalizedEmail = normalizeEmail(email);
    const existing = await ECUser.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const ec = await ECUser.create({
      name,
      email: normalizedEmail,
      password,
      schoolId,
    });

    school.ecMembers.push(ec._id);
    await school.save();
    await notifySchoolAdmins({
      schoolId,
      type: "ec_admin_member_added",
      title: "Admin member added",
      message: `${name} was added as an admin member.`,
      priority: "normal",
      data: { adminId: ec._id.toString(), email: ec.email },
    });

    return res.status(201).json({ message: "EC member added", ecId: ec._id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const listECMembers = async (req, res) => {
  const { schoolId } = req.params;

  try {
    const school = await School.findById(schoolId).populate("ecMembers", "-password");
    if (!school) return res.status(404).json({ error: "School not found" });
    const studentAdmins = await Student.find({
      schoolId,
      accountRole: "admin",
    }).select("firstName lastName email schoolId createdAt updatedAt");

    res.json([
      ...school.ecMembers.map((member) => ({
        _id: member._id,
        name: member.name,
        email: member.email,
        schoolId: member.schoolId,
        accountType: "legacy_admin",
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
      })),
      ...studentAdmins.map((student) => ({
        _id: student._id,
        name: `${student.firstName || ""} ${student.lastName || ""}`.trim(),
        email: student.email,
        schoolId: student.schoolId,
        accountType: "student_admin",
        createdAt: student.createdAt,
        updatedAt: student.updatedAt,
      })),
    ]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const removeECMember = async (req, res) => {
  const { ecId } = req.params;
  const schoolId = req.schoolId;

  try {
    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) return res.status(404).json({ error: "School not found" });

    const studentAdmin = await Student.findOne({
      _id: ecId,
      schoolId,
      accountRole: "admin",
    });
    if (studentAdmin) {
      studentAdmin.accountRole = "student";
      studentAdmin.adminAssignedAt = null;
      studentAdmin.adminAssignedBy = null;
      await studentAdmin.save();
      await notifySchoolAdmins({
        schoolId,
        type: "ec_admin_member_removed",
        title: "Admin member removed",
        message: `${studentAdmin.firstName} ${studentAdmin.lastName} was removed as an admin.`,
        priority: "normal",
        data: { adminId: ecId },
      });
      return res.json({ message: "Admin member removed" });
    }

    const ecIndex = school.ecMembers.findIndex((ec) => ec._id.toString() === ecId);
    if (ecIndex === -1) {
      return res.status(404).json({ error: "EC member not found" });
    }

    const removedMember = school.ecMembers[ecIndex];
    school.ecMembers.splice(ecIndex, 1);
    await school.save();
    await ECUser.findByIdAndDelete(ecId);
    await notifySchoolAdmins({
      schoolId,
      type: "ec_admin_member_removed",
      title: "Admin member removed",
      message: `${removedMember?.name || removedMember?.email || "An admin member"} was removed.`,
      priority: "normal",
      data: { adminId: ecId },
      excludeAdminIds: [ecId],
    });

    res.json({ message: "EC member removed" });
  } catch (err) {
    console.error("Remove EC member error:", err);
    res.status(500).json({ error: err.message });
  }
};
