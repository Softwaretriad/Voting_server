import Voter from "../models/Voter.js";

const normalizeStudentRegistryId = (value) => String(value || "").trim();
const shouldPreferVoterCollection = () =>
  process.env.ELIGIBILITY_SOURCE !== "embedded_first";
const ELECTION_VOTER_SET_CACHE_TTL_MS =
  Number(process.env.ELECTION_VOTER_SET_CACHE_TTL_SECONDS || 30) * 1000;
const electionVoterSetCache = new Map();

const getElectionVoterSetCacheKey = ({ schoolId, electionId }) =>
  `${schoolId?.toString?.() || schoolId}:${electionId?.toString?.() || electionId}`;

const loadElectionVoterSet = async ({ schoolId, electionId }) => {
  const rows = await Voter.find({
    schoolId,
    electionId,
  })
    .select("studentId")
    .lean();

  return new Set(rows.map((row) => normalizeStudentRegistryId(row.studentId)));
};

const getElectionVoterSet = async ({ schoolId, electionId }) => {
  const cacheKey = getElectionVoterSetCacheKey({ schoolId, electionId });
  const cached = electionVoterSetCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const promise = loadElectionVoterSet({ schoolId, electionId }).catch((error) => {
    electionVoterSetCache.delete(cacheKey);
    throw error;
  });

  electionVoterSetCache.set(cacheKey, {
    promise,
    expiresAt: Date.now() + ELECTION_VOTER_SET_CACHE_TTL_MS,
  });

  return promise;
};

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

  const studentRegistryId = normalizeStudentRegistryId(student.studentId);
  if (!studentRegistryId) {
    return false;
  }

  const eligibleVoterSet = await getElectionVoterSet({
    schoolId: election.schoolId,
    electionId: election._id,
  });
  if (eligibleVoterSet.has(studentRegistryId)) {
    return true;
  }

  return shouldPreferVoterCollection() ? false : isEmbeddedEligible(election, student);
};

export const filterEligibleElectionsForStudent = async ({ elections, student }) => {
  if (!student || !Array.isArray(elections) || elections.length === 0) {
    return [];
  }

  const studentRegistryId = normalizeStudentRegistryId(student.studentId);
  if (!studentRegistryId) {
    return [];
  }

  const electionIds = elections.map((election) => election._id);

  let uploadedEligibleElectionIds = new Set();
  if (electionIds.length > 0) {
    const voterRows = await Voter.find({
      schoolId: student.schoolId,
      electionId: { $in: electionIds },
      studentId: studentRegistryId,
    })
      .select("electionId")
      .lean();

    uploadedEligibleElectionIds = new Set(
      voterRows.map((row) => row.electionId?.toString()).filter(Boolean)
    );
  }

  if (shouldPreferVoterCollection()) {
    return elections.filter((election) =>
      uploadedEligibleElectionIds.has(election._id.toString())
    );
  }

  const embeddedEligibleElectionIds = new Set(
    elections
      .filter((election) => isEmbeddedEligible(election, student))
      .map((election) => election._id.toString())
  );

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

  const eligibleVoterSet = await getElectionVoterSet({
    schoolId: schoolId || election.schoolId,
    electionId: election._id,
  });
  if (eligibleVoterSet.has(normalizedStudentRegistryId)) {
    return true;
  }

  if (shouldPreferVoterCollection()) {
    return false;
  }

  return (election.eligibleVoters || []).some(
    (voterRow) =>
      normalizeStudentRegistryId(voterRow?.studentId) === normalizedStudentRegistryId
  );
};
