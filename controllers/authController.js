import School from "../models/school.js";
import ECUser from "../models/ECUser.js";
import Student from "../models/Student.js";
import plans from "../utils/plans.js";
import sendEmail from "../utils/sendEmail.js";
import { recordActivity } from "../utils/activityLog.js";
import { createOtp, getOtpExpiry } from "../utils/studentAuth.js";
import { notifyAdmin, notifySchoolAdmins } from "../utils/notificationService.js";
import {
  compareSecret,
  createOpaqueToken,
  hashSecret,
  isStrongPassword,
  normalizeEmail,
  strongPasswordMessage,
} from "../utils/security.js";

const MAX_ADMINS_PER_SCHOOL = 5;
const sendAdminAssignedEmail = async ({ email, schoolName }) => {
  await sendEmail(
    email,
    "You have been assigned as a MyUniVote admin",
    `You have been assigned as an admin for ${schoolName}. Log out and log back in to access the admin view with your existing account.`
  );
};

export const registerEC = async (req, res) => {
  try {
    const { name, email, password, plan, schoolId } = req.body;

    if (!email || !password || !plan || !name || !schoolId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ error: "Admin password must be at least 8 characters" });
    }

    const selectedPlan = plans[plan] || plans.free;
    const normalizedEmail = normalizeEmail(email);
    const existing = await ECUser.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) {
      return res.status(404).json({ error: "School not found" });
    }

    const alreadyInSchool = school.ecMembers.some((ec) => ec.email === normalizedEmail);
    if (alreadyInSchool) {
      return res.status(400).json({ error: "EC already part of this school" });
    }

    if (school.ecMembers.length >= 5) {
      return res.status(400).json({ error: "Maximum of 5 EC members allowed" });
    }

    const user = await ECUser.create({
      name,
      email: normalizedEmail,
      password,
      status: "active",
      plan,
      maxVoters: selectedPlan.maxVoters,
      schoolId,
    });

    school.ecMembers.push(user._id);
    await school.save();

    res.status(201).json({ message: "EC registered and added to school", user });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
};

export const inviteECMembers = async (req, res) => {
  try {
    const { emails, schoolId: bodySchoolId } = req.body || {};
    const schoolId = bodySchoolId || req.schoolId;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: "emails must be a non-empty array" });
    }

    const school = await School.findById(schoolId).populate("ecMembers");
    if (!school) {
      return res.status(404).json({ error: "School not found" });
    }

    if (req.schoolId?.toString() !== school._id.toString()) {
      return res.status(403).json({ error: "You are not allowed to invite admins for this school" });
    }

    const normalizedEmails = Array.from(
      new Set(
        emails.map((email) => normalizeEmail(email)).filter(Boolean)
      )
    );

    if (normalizedEmails.length === 0) {
      return res.status(400).json({ error: "At least one valid email is required" });
    }

    const [existingMembers, existingStudentAdmins, matchingStudents] = await Promise.all([
      ECUser.find({
        $or: [{ schoolId: school._id }, { email: { $in: normalizedEmails } }],
      }),
      Student.find({
        schoolId: school._id,
        accountRole: "admin",
      }).select("email"),
      Student.find({
        schoolId: school._id,
        email: { $in: normalizedEmails },
      }),
    ]);

    const existingAdminEmails = new Set([
      ...existingMembers
        .filter((member) => member.schoolId?.toString() === school._id.toString())
        .map((member) => member.email),
      ...existingStudentAdmins.map((student) => student.email),
    ]);
    const newEmailCount = normalizedEmails.filter((email) => !existingAdminEmails.has(email)).length;
    const currentMemberCount = existingAdminEmails.size;

    if (currentMemberCount + newEmailCount > MAX_ADMINS_PER_SCHOOL) {
      return res.status(400).json({
        error: `A school can have at most ${MAX_ADMINS_PER_SCHOOL} admins.`,
      });
    }

    const assigned = [];
    const skipped = [];

    for (const email of normalizedEmails) {
      const matchingStudent = matchingStudents.find((student) => student.email === email);
      if (!matchingStudent) {
        skipped.push({
          email,
          reason: "Student account not found for this school",
        });
        continue;
      }

      if (matchingStudent.accountRole === "admin") {
        skipped.push({
          email,
          reason: "Student is already an admin for this school",
        });
        continue;
      }

      matchingStudent.accountRole = "admin";
      matchingStudent.adminAssignedAt = new Date();
      matchingStudent.adminAssignedBy = req.ecUser?._id || null;
      await matchingStudent.save();

      await sendAdminAssignedEmail({
        email,
        schoolName: school.fullName || school.name,
      });
      await notifyAdmin({
        adminId: matchingStudent._id,
        schoolId: matchingStudent.schoolId,
        type: "ec_admin_member_added",
        title: "Admin access activated",
        message: "Your account has been switched to admin. Log out and log back in to access the admin view.",
        priority: "normal",
      });

      assigned.push({
        email,
        adminUserId: matchingStudent._id.toString(),
        role: matchingStudent.accountRole,
      });
    }

    if (assigned.length > 0) {
      await recordActivity({
        actorType: "admin",
        actorId: req.ecUser?._id,
        schoolId: school._id,
        action: "Admin Members Assigned",
        metadata: {
          assignedEmails: assigned.map((item) => item.email),
          skippedEmails: skipped.map((item) => item.email),
        },
      });
      await notifySchoolAdmins({
        schoolId: school._id,
        type: "ec_admin_member_added",
        title: "Admin member added",
        message: `${assigned.length} admin member(s) were added for ${school.fullName || school.name}.`,
        priority: "normal",
        data: {
          assignedEmails: assigned.map((item) => item.email),
        },
      });
    }

    return res.status(201).json({
      message: "Admin assignments processed",
      assigned,
      skipped,
      maxAdminsPerSchool: MAX_ADMINS_PER_SCHOOL,
    });
  } catch (err) {
    console.error("ADMIN INVITE ERROR:", err);
    return res.status(500).json({ error: err.message || "Failed to invite admins" });
  }
};

export const getAdminInviteDetails = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ error: "token is required" });
    }

    const candidates = await ECUser.find({
      status: "pending",
      inviteTokenExpires: { $gt: new Date() },
    }).populate("schoolId", "name fullName shortName");

    let invite = null;
    for (const candidate of candidates) {
      if (await compareSecret(token, candidate.inviteTokenHash)) {
        invite = candidate;
        break;
      }
    }

    if (!invite) {
      return res.status(404).json({ error: "Invitation is invalid or has expired" });
    }

    return res.status(200).json({
      email: invite.email,
      status: invite.status,
      school: {
        _id: invite.schoolId?._id?.toString?.() || null,
        name: invite.schoolId?.name || "",
        fullName: invite.schoolId?.fullName || invite.schoolId?.name || "",
        shortName: invite.schoolId?.shortName || "",
      },
      inviteExpiresAt: invite.inviteTokenExpires?.toISOString() || null,
    });
  } catch (err) {
    console.error("ADMIN INVITE DETAILS ERROR:", err);
    return res.status(500).json({ error: err.message || "Failed to load invite details" });
  }
};

export const completeAdminInvite = async (req, res) => {
  try {
    const { token, name, password } = req.body || {};

    if (!token || !name || !password) {
      return res.status(400).json({ error: "token, name, and password are required" });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: strongPasswordMessage });
    }

    const candidates = await ECUser.find({
      status: "pending",
      inviteTokenExpires: { $gt: new Date() },
    }).populate("schoolId", "name fullName");

    let admin = null;
    for (const candidate of candidates) {
      if (await compareSecret(token, candidate.inviteTokenHash)) {
        admin = candidate;
        break;
      }
    }

    if (!admin) {
      return res.status(401).json({ error: "Invitation is invalid or has expired" });
    }

    admin.name = String(name).trim();
    admin.password = password;
    admin.status = "active";
    admin.invitationAcceptedAt = new Date();
    admin.inviteTokenHash = null;
    admin.inviteTokenExpires = null;
    await admin.save();

    await recordActivity({
      actorType: "admin",
      actorId: admin._id,
      schoolId: admin.schoolId?._id || admin.schoolId,
      action: "Admin Invitation Accepted",
    });
    await notifyAdmin({
      adminId: admin._id,
      schoolId: admin.schoolId?._id || admin.schoolId,
      type: "ec_admin_member_added",
      title: "Admin access activated",
      message: "Your admin access has been activated successfully.",
      priority: "normal",
    });

    return res.status(200).json({
      message: "Admin password created successfully",
      email: admin.email,
      schoolName: admin.schoolId?.fullName || admin.schoolId?.name || "",
    });
  } catch (err) {
    console.error("ADMIN COMPLETE INVITE ERROR:", err);
    return res.status(500).json({ error: err.message || "Failed to complete invitation" });
  }
};

export const forgotAdminPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const admin = await ECUser.findOne({ email: normalizeEmail(email) });

    if (!admin) {
      return res.status(200).json({});
    }

    const otp = createOtp();
    admin.passwordResetOtp = await hashSecret(otp);
    admin.passwordResetOtpExpires = getOtpExpiry();
    await admin.save();

    await sendEmail(
      admin.email,
      "Reset your MyUniVote admin password",
      `Your MyUniVote admin password reset code is ${otp}. It expires in 10 minutes.`
    );

    await recordActivity({
      actorType: "admin",
      actorId: admin._id,
      schoolId: admin.schoolId,
      action: "Admin Password Reset Requested",
    });

    return res.status(200).json({});
  } catch (err) {
    console.error("ADMIN FORGOT PASSWORD ERROR:", err);
    return res.status(500).json({ error: err.message || "Failed to send reset OTP" });
  }
};

export const verifyAdminResetOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const admin = await ECUser.findOne({ email: normalizeEmail(email) });

    if (
      !admin ||
      !(await compareSecret(otp, admin.passwordResetOtp)) ||
      !admin.passwordResetOtpExpires ||
      admin.passwordResetOtpExpires < new Date()
    ) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    admin.passwordResetOtp = null;
    admin.passwordResetOtpExpires = null;
    const resetToken = createOpaqueToken();
    admin.passwordResetTokenHash = await hashSecret(resetToken);
    admin.passwordResetTokenExpires = new Date(Date.now() + 10 * 60 * 1000);
    await admin.save();

    return res.status(200).json({ resetToken });
  } catch (err) {
    console.error("ADMIN VERIFY RESET OTP ERROR:", err);
    return res.status(500).json({ error: err.message || "Failed to verify reset OTP" });
  }
};

export const resetAdminPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: "resetToken and newPassword are required" });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: strongPasswordMessage });
    }

    const candidates = await ECUser.find({
      passwordResetTokenExpires: { $gt: new Date() },
    });

    let admin = null;
    for (const candidate of candidates) {
      if (await compareSecret(resetToken, candidate.passwordResetTokenHash)) {
        admin = candidate;
        break;
      }
    }

    if (!admin) {
      return res.status(401).json({ error: "Invalid or expired reset token" });
    }

    admin.password = newPassword;
    admin.passwordResetTokenHash = null;
    admin.passwordResetTokenExpires = null;
    await admin.save();

    await recordActivity({
      actorType: "admin",
      actorId: admin._id,
      schoolId: admin.schoolId,
      action: "Admin Password Reset Completed",
    });

    return res.status(200).json({});
  } catch (err) {
    console.error("ADMIN RESET PASSWORD ERROR:", err);
    return res.status(500).json({ error: err.message || "Failed to reset password" });
  }
};
