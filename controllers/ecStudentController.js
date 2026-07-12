import Student from "../models/Student.js";
import { sendError } from "../utils/apiResponse.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const searchEcStudents = async (req, res) => {
  try {
    const schoolId = req.schoolId || req.ecUser?.schoolId;
    if (!schoolId) {
      return sendError(res, 403, "EC user is not assigned to a school");
    }

    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      return sendError(res, 400, "q must be at least 2 characters");
    }

    const escaped = escapeRegex(q);
    const searchRegex = new RegExp(escaped, "i");
    const students = await Student.find({
      schoolId,
      $or: [
        { studentId: searchRegex },
        { firstName: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
        { department: searchRegex },
        { nationality: searchRegex },
        { programOfStudy: searchRegex },
      ],
    })
      .sort({ lastName: 1, firstName: 1 })
      .limit(25)
      .select(
        "_id studentId firstName lastName email department nationality programOfStudy currentYearOfStudy accountRole"
      )
      .lean();

    return res.status(200).json({
      results: students.map((student) => {
        const fullName = [student.firstName, student.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();

        return {
          userId: student._id.toString(),
          studentId: student.studentId,
          name: fullName,
          firstName: student.firstName,
          lastName: student.lastName,
          email: student.email,
          faculty: student.department,
          nationality: student.nationality || "",
          programmeOfStudy: student.programOfStudy,
          level:
            student.currentYearOfStudy == null
              ? ""
              : String(student.currentYearOfStudy),
          role: student.accountRole || "student",
          aspirantDraft: {
            name: fullName,
            studentId: student.studentId,
            programmeOfStudy: student.programOfStudy,
            level:
              student.currentYearOfStudy == null
                ? ""
                : String(student.currentYearOfStudy),
            faculty: student.department,
          },
        };
      }),
    });
  } catch (error) {
    return sendError(res, 500, error.message || "Failed to search students");
  }
};
