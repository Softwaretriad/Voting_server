import http from "k6/http";
import { check, fail, group, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const STUDENT_TOKEN = __ENV.STUDENT_TOKEN || "";
const STUDENT_ID = __ENV.STUDENT_ID || "";
const VOTERS_JSON_FILE = __ENV.VOTERS_JSON_FILE || "";
const VOTER_INDEX = Math.max(0, Number(__ENV.VOTER_INDEX || 0));
const SCHOOL_ID = __ENV.SCHOOL_ID || "";
const WARMUP_VUS = Number(__ENV.WARMUP_VUS || 250);
const TARGET_VUS = Number(__ENV.TARGET_VUS || 500);
const DEFAULT_P95_THRESHOLD_MS =
  TARGET_VUS <= 200 ? 800 : TARGET_VUS <= 500 ? 2500 : 8000;
const READ_P95_THRESHOLD_MS = Number(
  __ENV.READ_P95_THRESHOLD_MS || DEFAULT_P95_THRESHOLD_MS
);

const schoolsLatency = new Trend("schools_latency");
const facultiesLatency = new Trend("faculties_latency");
const profileLatency = new Trend("profile_latency");
const activeElectionsLatency = new Trend("active_elections_latency");
const scheduleLatency = new Trend("schedule_latency");
const resultsLatency = new Trend("results_latency");

export const options = {
  scenarios: {
    read_flow: {
      executor: "ramping-vus",
      stages: [
        { duration: "30s", target: WARMUP_VUS },
        { duration: "1m", target: TARGET_VUS },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: [`p(95)<${READ_P95_THRESHOLD_MS}`],
    active_elections_latency: [`p(95)<${READ_P95_THRESHOLD_MS}`],
    schools_latency: [`p(95)<${READ_P95_THRESHOLD_MS}`],
    faculties_latency: [`p(95)<${READ_P95_THRESHOLD_MS}`],
    profile_latency: [`p(95)<${READ_P95_THRESHOLD_MS}`],
    schedule_latency: [`p(95)<${READ_P95_THRESHOLD_MS}`],
    results_latency: [`p(95)<${READ_P95_THRESHOLD_MS}`],
  },
};

function json(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

function authHeaders(token) {
  return token
    ? {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      }
    : {
        Accept: "application/json",
    };
}

function openVotersFile(path) {
  const normalizedPath = String(path || "").replace(/\\/g, "/");
  const candidates = [
    normalizedPath,
    `../../${normalizedPath}`,
  ];

  for (const candidate of candidates) {
    try {
      return open(candidate).replace(/^\uFEFF/, "");
    } catch {
      // Try the next path style. k6 resolves relative paths from the script file.
    }
  }

  fail("VOTERS_JSON_FILE must point to a readable JSON array.");
  return "";
}

function readSeedVoter() {
  if (!VOTERS_JSON_FILE) {
    return null;
  }

  try {
    const voters = JSON.parse(openVotersFile(VOTERS_JSON_FILE));
    if (!Array.isArray(voters) || voters.length === 0) {
      fail("VOTERS_JSON_FILE must contain a non-empty JSON array.");
    }
    return voters[Math.min(VOTER_INDEX, voters.length - 1)];
  } catch {
    fail("VOTERS_JSON_FILE must point to a readable JSON array.");
  }
  return null;
}

const SEED_VOTER = VOTERS_JSON_FILE && (!STUDENT_TOKEN || !STUDENT_ID) ? readSeedVoter() : null;

export function setup() {
  const schoolsRes = http.get(`${BASE_URL}/schools`, {
    headers: { Accept: "application/json" },
  });

  if (schoolsRes.status !== 200) {
    fail(`API is not reachable at ${BASE_URL}/schools. Start the backend and verify BASE_URL.`);
  }

  const schools = json(schoolsRes);
  const firstSchool = Array.isArray(schools) ? schools[0] : null;
  const state = {
    schoolId: SCHOOL_ID || firstSchool?.id || firstSchool?._id || "",
    accessToken: STUDENT_TOKEN || SEED_VOTER?.token || "",
    userId: STUDENT_ID || SEED_VOTER?.studentId || "",
  };

  return state;
}

export default function (state) {
  group("public school catalog", () => {
    const schoolsRes = http.get(`${BASE_URL}/schools`, {
      headers: { Accept: "application/json" },
    });
    schoolsLatency.add(schoolsRes.timings.duration);

    check(schoolsRes, {
      "schools status is 200": (res) => res.status === 200,
      "schools returns array": (res) => Array.isArray(json(res)),
    });

    if (state.schoolId) {
      const facultiesRes = http.get(`${BASE_URL}/schools/${state.schoolId}/faculties`, {
        headers: { Accept: "application/json" },
      });
      facultiesLatency.add(facultiesRes.timings.duration);

      check(facultiesRes, {
        "faculties status is 200": (res) => res.status === 200,
      });
    }
  });

  if (!state.accessToken) {
    sleep(1);
    return;
  }

  group("authenticated student reads", () => {
    const headers = authHeaders(state.accessToken);

    if (state.userId) {
      const profileRes = http.get(`${BASE_URL}/students/${state.userId}`, { headers });
      profileLatency.add(profileRes.timings.duration);
      check(profileRes, {
        "profile status is 200": (res) => res.status === 200,
      });
    }

    const activeRes = http.get(`${BASE_URL}/elections/active`, { headers });
    activeElectionsLatency.add(activeRes.timings.duration);

    check(activeRes, {
      "active elections status is 200": (res) => res.status === 200,
      "active elections returns array": (res) => Array.isArray(json(res)),
    });

    const scheduleRes = http.get(`${BASE_URL}/elections/schedule`, { headers });
    scheduleLatency.add(scheduleRes.timings.duration);
    check(scheduleRes, {
      "schedule status is 200": (res) => res.status === 200,
    });

    const resultsRes = http.get(`${BASE_URL}/elections/results`, { headers });
    resultsLatency.add(resultsRes.timings.duration);
    check(resultsRes, {
      "results status is 200": (res) => res.status === 200,
    });
  });

  sleep(1);
}
