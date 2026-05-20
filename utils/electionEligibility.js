import Voter from "../models/Voter.js";

const normalizeStudentRegistryId = (value) => String(value || "").trim();

const isEmbeddedEligible = (election, student) => {
  const studentRegistryId = normalizeStudentRegistryId(student?.studentId);
  if (!studentRegistryId) {
    return false;
  }

  return (election?.eligibleVoters || []).some(
    (voter) => normalizeStudentRegistryId(voter?.studentId) === studentRegistryId
  );
};

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

  if (isEmbeddedEligible(election, student)) {
    return true;
  }

  const studentRegistryId = normalizeStudentRegistryId(student.studentId);
  if (!studentRegistryId) {
    return false;
  }

  const voter = await Voter.findOne({
    schoolId: election.schoolId,
    electionId: election._id,
    studentId: studentRegistryId,
  }).select("_id");

  return Boolean(voter);
};

export const filterEligibleElectionsForStudent = async ({ elections, student }) => {
  if (!student || !Array.isArray(elections) || elections.length === 0) {
    return [];
  }

  const studentRegistryId = normalizeStudentRegistryId(student.studentId);
  if (!studentRegistryId) {
    return [];
  }

  const embeddedEligibleElectionIds = new Set(
    elections
      .filter((election) => isEmbeddedEligible(election, student))
      .map((election) => election._id.toString())
  );

  const missingLookupElectionIds = elections
    .filter((election) => !embeddedEligibleElectionIds.has(election._id.toString()))
    .map((election) => election._id);

  let uploadedEligibleElectionIds = new Set();
  if (missingLookupElectionIds.length > 0) {
    const voterRows = await Voter.find({
      schoolId: student.schoolId,
      electionId: { $in: missingLookupElectionIds },
      studentId: studentRegistryId,
    }).select("electionId");

    uploadedEligibleElectionIds = new Set(
      voterRows.map((row) => row.electionId?.toString()).filter(Boolean)
    );
  }

  return elections.filter((election) => {
    const electionId = election._id.toString();
    return (
      embeddedEligibleElectionIds.has(electionId) ||
      uploadedEligibleElectionIds.has(electionId)
    );
  });
};

export const isStudentRegistryIdInElectionVoters = async ({
  election,
  schoolId,
  studentRegistryId,
}) => {
  const normalizedStudentRegistryId = normalizeStudentRegistryId(studentRegistryId);
  if (!normalizedStudentRegistryId || !election) {
    return false;
  }

  const embeddedMatch = (election.eligibleVoters || []).some(
    (voter) => normalizeStudentRegistryId(voter?.studentId) === normalizedStudentRegistryId
  );
  if (embeddedMatch) {
    return true;
  }

  const voter = await Voter.findOne({
    schoolId: schoolId || election.schoolId,
    electionId: election._id,
    studentId: normalizedStudentRegistryId,
  }).select("_id");

  return Boolean(voter);
};
