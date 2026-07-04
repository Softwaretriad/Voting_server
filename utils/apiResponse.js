export const sendError = (res, statusCode, message, extra = {}) =>
  res.status(statusCode).json({
    message,
    statusCode,
    ...extra,
  });

export const sanitizeStudent = (student, extra = {}) => ({
  id: student._id.toString(),
  email: student.email,
  isEmailVerified: student.isEmailVerified,
  firstName: student.firstName,
  lastName: student.lastName,
  gender: student.gender,
  phone: student.phone,
  universityFullName: student.universityFullName,
  department: student.department,
  currentYearOfStudy: student.currentYearOfStudy,
  programOfStudy: student.programOfStudy,
  nationality: student.nationality || "",
  authProvider: student.authProvider || "password",
  hasVotingPin: Boolean(student.votingPin),
  universityLogoUrl: extra.universityLogoUrl || "",
});

export const sanitizeStudentProfile = (student, extra = {}) => ({
  id: student._id.toString(),
  email: student.email,
  isEmailVerified: student.isEmailVerified,
  firstName: student.firstName,
  lastName: student.lastName,
  phoneNumber: student.phone,
  gender: student.gender,
  universityFullName: student.universityFullName,
  department: student.department,
  currentYearOfStudy: student.currentYearOfStudy,
  programOfStudy: student.programOfStudy,
  nationality: student.nationality || "",
  authProvider: student.authProvider || "password",
  hasVotingPin: Boolean(student.votingPin),
  universityLogoUrl: extra.universityLogoUrl || "",
});
