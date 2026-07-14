import http from "k6/http";
import { check, fail, sleep } from "k6";
import exec from "k6/execution";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const CONFIRM = __ENV.LOAD_TEST_CONFIRM || "cast-votes";
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

function parseVoters() {
  const votersJson = (
    __ENV.VOTERS_JSON ||
    (__ENV.VOTERS_JSON_FILE ? openVotersFile(__ENV.VOTERS_JSON_FILE) : "")
  ).replace(/^\uFEFF/, "");
  if (votersJson) {
    try {
      const voters = JSON.parse(votersJson);
      if (Array.isArray(voters) && voters.length > 0) {
        return voters.map((voter) => ({
          email: voter.email || "",
          studentId: voter.studentId || "",
          token: voter.token || "",
          votingPin: String(voter.votingPin || voter.pin || DEFAULT_PIN),
        }));
      }
    } catch {
      fail("VOTERS_JSON or VOTERS_JSON_FILE must be a JSON array of voter objects.");
    }
  }

  return [
    {
      email: __ENV.STUDENT_EMAIL || "",
      studentId: __ENV.STUDENT_ID || "",
      token: __ENV.STUDENT_TOKEN || "",
      votingPin: DEFAULT_PIN,
    },
  ];
}

function requireVoteTestInputs() {
  if (CONFIRM !== "cast-votes") {
    fail("Set LOAD_TEST_CONFIRM=cast-votes to run this destructive vote-write test.");
  }

  if (!ELECTION_ID || !ASPIRANT_ID) {
    fail("Set ELECTION_ID and ASPIRANT_ID for the test election target.");
  }

  const missingCredential = VOTERS.find((voter) => !voter.token || !voter.studentId);
  if (missingCredential) {
    fail(
      "Provide STUDENT_TOKEN/STUDENT_ID or VOTERS_JSON entries with token and studentId. Password login is retired."
    );
  }
}

export function setup() {
  requireVoteTestInputs();

  const sessions = VOTERS.map((voter) => {
    return {
      email: voter.email,
      token: voter.token,
      studentId: voter.studentId,
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
