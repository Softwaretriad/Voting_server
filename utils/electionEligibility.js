import { doesStudentMatchElectionAudience } from "./electionAudience.js";

const normalizeStudentRegistryId = (value) => String(value || "").trim();

export const isStudentEligibleForElection = async ({ election, student }) => {
  if (!election || !student) {
    return false;
  }

  if (
    student.schoolId?.toString?.() &&
    election.schoolId?.toString?.() &&
    election.schoolId.toString() !== student.schoolId.toString()
  ) {
    return false;
  }

  const studentRegistryId = normalizeStudentRegistryId(student.studentId);
  if (!studentRegistryId) {
    return false;
  }

  return doesStudentMatchElectionAudience({ election, student });
};

export const filterEligibleElectionsForStudent = async ({ elections, student }) => {
  if (!student || !Array.isArray(elections) || elections.length === 0) {
    return [];
  }

  const studentRegistryId = normalizeStudentRegistryId(student.studentId);
  if (!studentRegistryId) {
    return [];
  }

  const audienceEligibleElectionIds = new Set(
    elections
      .filter((election) => doesStudentMatchElectionAudience({ election, student }))
      .map((election) => election._id.toString())
  );

  return elections.filter((election) => {
    const electionId = election._id.toString();
    return audienceEligibleElectionIds.has(electionId);
  });
};

export const isStudentRegistryIdInElectionVoters = async ({
  election,
  schoolId,
  studentRegistryId,
  student = null,
}) => {
  const normalizedStudentRegistryId = normalizeStudentRegistryId(studentRegistryId);
  if (!normalizedStudentRegistryId || !election) {
    return false;
  }

  return student ? doesStudentMatchElectionAudience({ election, student }) : false;
};
