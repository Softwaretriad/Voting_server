import http from "k6/http";
import { check, fail, group, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const STUDENT_EMAIL = __ENV.STUDENT_EMAIL || "10420742@wiuc-ghana.edu.gh";
const STUDENT_PASSWORD = __ENV.STUDENT_PASSWORD || "Nwanna123$";
const WARMUP_VUS = Number(__ENV.WARMUP_VUS || 20);
const TARGET_VUS = Number(__ENV.TARGET_VUS || 50);

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
    http_req_duration: ["p(95)<800"],
    active_elections_latency: ["p(95)<800"],
    schools_latency: ["p(95)<800"],
    faculties_latency: ["p(95)<800"],
    profile_latency: ["p(95)<800"],
    schedule_latency: ["p(95)<800"],
    results_latency: ["p(95)<800"],
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
    schoolId: firstSchool?.id || firstSchool?._id || "",
    accessToken: "",
    userId: "",
  };

  if (!STUDENT_EMAIL || !STUDENT_PASSWORD) {
    return state;
  }

  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({
      email: STUDENT_EMAIL,
      password: STUDENT_PASSWORD,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );

  check(loginRes, {
    "login succeeded": (res) => res.status === 200,
  });

  const login = json(loginRes) || {};
  state.accessToken = login.accessToken || login.token || "";
  state.userId = login.user?.id || login.user?._id || "";
  state.schoolId = login.user?.schoolId || state.schoolId;

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
