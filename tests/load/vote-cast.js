import http from "k6/http";
import { check, fail, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const CONFIRM = __ENV.LOAD_TEST_CONFIRM || "";
const ELECTION_ID = __ENV.ELECTION_ID || "";
const ASPIRANT_ID = __ENV.ASPIRANT_ID || "";
const DEFAULT_PIN = __ENV.STUDENT_VOTING_PIN || "1234";
const VOTERS = parseVoters();
const VUS = Number(__ENV.VUS || Math.min(Math.max(VOTERS.length, 1), 25));
const ITERATIONS = Number(__ENV.ITERATIONS || VOTERS.length);

const voteLatency = new Trend("vote_cast_latency");
const createdVotes = new Counter("vote_created_total");
const duplicateVotes = new Counter("vote_duplicate_total");
const unexpectedVoteStatuses = new Rate("vote_unexpected_status_rate");

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409));

export const options = {
  scenarios: {
    vote_cast: {
      executor: "shared-iterations",
      vus: VUS,
      iterations: ITERATIONS,
      maxDuration: __ENV.MAX_DURATION || "2m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<2500"],
    vote_cast_latency: ["p(95)<2500"],
    vote_unexpected_status_rate: ["rate<0.01"],
  },
};

function parseVoters() {
  if (__ENV.VOTERS_JSON) {
    try {
      const voters = JSON.parse(__ENV.VOTERS_JSON);
      if (Array.isArray(voters) && voters.length > 0) {
        return voters.map((voter) => ({
          email: voter.email || "",
          password: voter.password || "",
          studentId: voter.studentId || "",
          token: voter.token || "",
          votingPin: String(voter.votingPin || voter.pin || DEFAULT_PIN),
        }));
      }
    } catch {
      fail("VOTERS_JSON must be a JSON array of voter objects.");
    }
  }

  return [
    {
      email: __ENV.STUDENT_EMAIL || "",
      password: __ENV.STUDENT_PASSWORD || "",
      studentId: __ENV.STUDENT_ID || "",
      token: __ENV.STUDENT_TOKEN || "",
      votingPin: DEFAULT_PIN,
    },
  ];
}

function json(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}

function requireVoteTestInputs() {
  if (CONFIRM !== "cast-votes") {
    fail("Set LOAD_TEST_CONFIRM=cast-votes to run this destructive vote-write test.");
  }

  if (!ELECTION_ID || !ASPIRANT_ID) {
    fail("Set ELECTION_ID and ASPIRANT_ID for the test election target.");
  }

  const missingCredential = VOTERS.find(
    (voter) => !voter.token && (!voter.email || !voter.password)
  );
  if (missingCredential) {
    fail(
      "Provide STUDENT_TOKEN/STUDENT_ID, STUDENT_EMAIL/STUDENT_PASSWORD, or VOTERS_JSON with token/studentId or email/password."
    );
  }
}

export function setup() {
  requireVoteTestInputs();

  const sessions = VOTERS.map((voter) => {
    if (voter.token && voter.studentId) {
      return {
        email: voter.email,
        token: voter.token,
        studentId: voter.studentId,
        votingPin: voter.votingPin,
      };
    }

    const loginRes = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({
        email: voter.email,
        password: voter.password,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );

    check(loginRes, {
      "login status is 200": (res) => res.status === 200,
    });

    if (loginRes.status !== 200) {
      fail(`Login failed for ${voter.email}`);
    }

    const login = json(loginRes) || {};
    const token = login.accessToken || login.token || "";
    const studentId = voter.studentId || login.user?.id || login.user?._id || "";

    if (!token || !studentId) {
      fail(`Login response for ${voter.email} did not include token and student id.`);
    }

    return {
      email: voter.email,
      token,
      studentId,
      votingPin: voter.votingPin,
    };
  });

  return {
    sessions,
  };
}

export default function (state) {
  const session = state.sessions[exec.scenario.iterationInTest % state.sessions.length];

  const voteRes = http.post(
    `${BASE_URL}/votes/cast`,
    JSON.stringify({
      studentId: session.studentId,
      electionId: ELECTION_ID,
      aspirantId: ASPIRANT_ID,
      votingPin: Number(session.votingPin),
    }),
    {
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    },
  );

  voteLatency.add(voteRes.timings.duration);

  const acceptedStatus = voteRes.status === 201 || voteRes.status === 409;
  unexpectedVoteStatuses.add(!acceptedStatus);

  if (voteRes.status === 201) {
    createdVotes.add(1);
  }
  if (voteRes.status === 409) {
    duplicateVotes.add(1);
  }

  check(voteRes, {
    "vote created or duplicate-blocked": () => acceptedStatus,
    "vote did not server-error": (res) => res.status < 500,
  });

  sleep(Number(__ENV.SLEEP_SECONDS || 0.1));
}
