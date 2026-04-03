export const sendError = (res, statusCode, message, extra = {}) =>
  res.status(statusCode).json({
    message,
    statusCode,
    ...extra,
  });

export const sanitizeStudent = (student) => ({
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
});

export const sanitizeStudentProfile = (student) => ({
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
});
