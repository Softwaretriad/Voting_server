export const ELECTION_AUDIENCE_SCOPES = new Set([
  "all_students",
  "faculty",
  "nationality",
  "faculty_nationality",
]);

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeList = (values = []) => {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    ),
  ];
};

const listIncludes = (values = [], value) => {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return false;
  }

  return values.map(normalizeText).includes(normalizedValue);
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toCaseInsensitiveExactMatchers = (values = []) =>
  normalizeList(values).map((value) => new RegExp(`^${escapeRegex(value)}$`, "i"));

export const normalizeElectionAudience = (input = {}) => {
  const source = input?.audience && typeof input.audience === "object"
    ? input.audience
    : input || {};
  const scope = normalizeText(source.scope || source.type || source.mode || "all_students");

  return {
    scope,
    faculties: normalizeList(source.faculties || source.faculty || source.departments),
    nationalities: normalizeList(source.nationalities || source.nationality),
  };
};

export const validateElectionAudience = (audience) => {
  const normalizedAudience = normalizeElectionAudience(audience);

  if (!ELECTION_AUDIENCE_SCOPES.has(normalizedAudience.scope)) {
    return "audience.scope must be one of all_students, faculty, nationality, or faculty_nationality";
  }

  if (normalizedAudience.scope === "faculty" && normalizedAudience.faculties.length === 0) {
    return "audience.faculties is required when audience.scope is faculty";
  }

  if (
    normalizedAudience.scope === "nationality" &&
    normalizedAudience.nationalities.length === 0
  ) {
    return "audience.nationalities is required when audience.scope is nationality";
  }

  if (normalizedAudience.scope === "faculty_nationality") {
    if (normalizedAudience.faculties.length === 0) {
      return "audience.faculties is required when audience.scope is faculty_nationality";
    }
    if (normalizedAudience.nationalities.length === 0) {
      return "audience.nationalities is required when audience.scope is faculty_nationality";
    }
  }

  return null;
};

export const doesStudentMatchElectionAudience = ({ election, student }) => {
  const audience = normalizeElectionAudience(election?.audience);
  if (audience.scope === "all_students") {
    return true;
  }

  const studentFaculty = student?.department || student?.faculty || "";
  const studentNationality = student?.nationality || "";
  const facultyMatches = listIncludes(audience.faculties, studentFaculty);
  const nationalityMatches = listIncludes(audience.nationalities, studentNationality);

  if (audience.scope === "faculty") {
    return facultyMatches;
  }

  if (audience.scope === "nationality") {
    return nationalityMatches;
  }

  if (audience.scope === "faculty_nationality") {
    return facultyMatches && nationalityMatches;
  }

  return false;
};

export const buildAudienceStudentQuery = (election) => {
  const audience = normalizeElectionAudience(election?.audience);
  const baseQuery = { schoolId: election.schoolId };

  if (audience.scope === "all_students") {
    return baseQuery;
  }

  if (audience.scope === "faculty") {
    return {
      ...baseQuery,
      department: { $in: toCaseInsensitiveExactMatchers(audience.faculties) },
    };
  }

  if (audience.scope === "nationality") {
    return {
      ...baseQuery,
      nationality: { $in: toCaseInsensitiveExactMatchers(audience.nationalities) },
    };
  }

  if (audience.scope === "faculty_nationality") {
    return {
      ...baseQuery,
      department: { $in: toCaseInsensitiveExactMatchers(audience.faculties) },
      nationality: { $in: toCaseInsensitiveExactMatchers(audience.nationalities) },
    };
  }

  return null;
};
