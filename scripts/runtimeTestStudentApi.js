import dotenv from "dotenv";
import mongoose from "mongoose";
import School from "../models/school.js";
import Student from "../models/Student.js";
import Election from "../models/Election.js";
import Candidate from "../models/candidates.js";
import { processElectionResults } from "../utils/electionResultsProcessor.js";
import { hashSecret } from "../utils/security.js";

dotenv.config();

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5000";
const uniqueSuffix = Date.now();

const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
};

const assertStatus = (result, expected, label) => {
  if (result.status !== expected) {
    throw new Error(`${label} failed. Expected ${expected}, got ${result.status}. Body: ${JSON.stringify(result.body)}`);
  }
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const school = await School.findOne({
    faculties: {
      $elemMatch: {
        programmes: {
          $elemMatch: { name: "BSc Computer Science" },
        },
      },
    },
  });

  if (!school) {
    throw new Error("No school with test faculties/programmes found. Run the demo seed first.");
  }

  const faculty = school.faculties.find((item) => item.programmes.length > 0);
  const programme = faculty.programmes[0];
  const email = `runtime-${uniqueSuffix}@example.com`;
  const initialPassword = "password123";
  const newPassword = "newpassword123";
  const emailOtp = "123456";
  const passwordResetOtp = "654321";

  const schoolsResult = await request("/schools");
  assertStatus(schoolsResult, 200, "GET /schools");

  const facultiesResult = await request(`/schools/${school._id}/faculties`);
  assertStatus(facultiesResult, 200, "GET /schools/:schoolId/faculties");

  const programmesResult = await request(
    `/schools/${school._id}/faculties/${faculty._id}/programmes`
  );
  assertStatus(
    programmesResult,
    200,
    "GET /schools/:schoolId/faculties/:facultyId/programmes"
  );

  const registerResult = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      studentId: `UG-${uniqueSuffix}`,
      firstName: "Runtime",
      lastName: "Tester",
      gender: "male",
      email,
      password: initialPassword,
      phone: "+233240000001",
      universityFullName: school.fullName || school.name,
      department: faculty.name,
      currentYearOfStudy: 3,
      programOfStudy: programme.name,
      votingPin: 1234,
    }),
  });
  assertStatus(registerResult, 201, "POST /auth/register");

  const registeredStudent = await Student.findOne({ email });
  registeredStudent.emailVerificationOtp = await hashSecret(emailOtp);
  registeredStudent.emailVerificationOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
  await registeredStudent.save();
  const verifyResult = await request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({
      email,
      otp: emailOtp,
    }),
  });
  assertStatus(verifyResult, 200, "POST /auth/verify-email");

  let accessToken = verifyResult.body.accessToken;
  let refreshToken = verifyResult.body.refreshToken;
  const userId = verifyResult.body.user.id;

  const authHeaders = () => ({
    Authorization: `Bearer ${accessToken}`,
  });

  const profileResult = await request(`/students/${userId}`, {
    headers: authHeaders(),
  });
  assertStatus(profileResult, 200, "GET /students/:userId");

  const activeResult = await request("/elections/active", {
    headers: authHeaders(),
  });
  assertStatus(activeResult, 200, "GET /elections/active");

  const scheduleResult = await request("/elections/schedule", {
    headers: authHeaders(),
  });
  assertStatus(scheduleResult, 200, "GET /elections/schedule");

  const statisticsResult = await request("/elections/statistics?year=2026", {
    headers: authHeaders(),
  });
  assertStatus(statisticsResult, 200, "GET /elections/statistics");

  const notificationsResult = await request(`/notifications/${userId}`, {
    headers: authHeaders(),
  });
  assertStatus(notificationsResult, 200, "GET /notifications/:userId");

  const newsResult = await request("/news/trending", {
    headers: authHeaders(),
  });
  assertStatus(newsResult, 200, "GET /news/trending");

  let electionId = activeResult.body[0]?._id;
  if (!electionId) {
    const fallbackElection = await Election.create({
      schoolId: school._id,
      title: `Runtime Election ${uniqueSuffix}`,
      description: "Runtime-generated election",
      subTitle: school.shortName || "",
      imageUrl: "",
      startTime: new Date(Date.now() - 30 * 60 * 1000),
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: "active",
      categories: [{ title: "SRC President", subTitle: school.shortName || "" }],
    });

    await Candidate.insertMany([
      {
        name: "Runtime Candidate A",
        position: "SRC President",
        schoolId: school._id,
        electionId: fallbackElection._id,
        categoryId: fallbackElection.categories[0]._id,
        department: faculty.name,
        imageUrl: "",
        title: fallbackElection.title,
        voteCount: 0,
      },
      {
        name: "Runtime Candidate B",
        position: "SRC President",
        schoolId: school._id,
        electionId: fallbackElection._id,
        categoryId: fallbackElection.categories[0]._id,
        department: faculty.name,
        imageUrl: "",
        title: fallbackElection.title,
        voteCount: 0,
      },
    ]);

    electionId = fallbackElection._id.toString();
  }

  const categoriesResult = await request(`/elections/${electionId}/categories`, {
    headers: authHeaders(),
  });
  assertStatus(categoriesResult, 200, "GET /elections/:electionId/categories");

  const aspirantsResult = await request(`/elections/${electionId}/aspirants`, {
    headers: authHeaders(),
  });
  assertStatus(aspirantsResult, 200, "GET /elections/:electionId/aspirants");

  const verifyPinResult = await request("/votes/verify-pin", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      studentId: userId,
      votingPin: 1234,
    }),
  });
  assertStatus(verifyPinResult, 200, "POST /votes/verify-pin");

  const castVoteResult = await request("/votes/cast", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      studentId: userId,
      electionId,
      aspirantId: aspirantsResult.body[0]._id,
      votingPin: 1234,
    }),
  });
  assertStatus(castVoteResult, 201, "POST /votes/cast");

  const categoryId = categoriesResult.body[0]?._id;
  if (!categoryId) {
    throw new Error("No category returned for runtime test.");
  }

  const categoryResultsResult = await request(`/categories/${categoryId}/results`, {
    headers: authHeaders(),
  });
  assertStatus(categoryResultsResult, 200, "GET /categories/:categoryId/results");

  const resultsResult = await request("/elections/results", {
    headers: authHeaders(),
  });
  assertStatus(resultsResult, 200, "GET /elections/results");

  const forgotPasswordResult = await request("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  assertStatus(forgotPasswordResult, 200, "POST /auth/forgot-password");

  const studentAfterResetRequest = await Student.findById(userId);
  studentAfterResetRequest.passwordResetOtp = await hashSecret(passwordResetOtp);
  studentAfterResetRequest.passwordResetOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
  await studentAfterResetRequest.save();
  const verifyResetResult = await request("/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({
      email,
      otp: passwordResetOtp,
    }),
  });
  assertStatus(verifyResetResult, 200, "POST /auth/verify-otp");

  const resetPasswordResult = await request("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({
      resetToken: verifyResetResult.body.resetToken,
      newPassword,
    }),
  });
  assertStatus(resetPasswordResult, 200, "POST /auth/reset-password");

  const loginResult = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: newPassword,
    }),
  });
  assertStatus(loginResult, 200, "POST /auth/login");

  accessToken = loginResult.body.accessToken;
  refreshToken = loginResult.body.refreshToken;

  const checkTokensResult = await request("/auth/check-tokens", {
    method: "POST",
    body: JSON.stringify({
      accessToken,
      refreshToken,
    }),
  });
  assertStatus(checkTokensResult, 200, "POST /auth/check-tokens");

  const election = await Election.findById(electionId);
  election.endTime = new Date(Date.now() - 1000);
  election.status = "active";
  await election.save();

  const processorResult = await processElectionResults({
    forceElectionIds: [election._id],
  });

  const processedElection = await Election.findById(electionId);
  if (processedElection.status !== "closed") {
    throw new Error("Election results processor did not close the election.");
  }

  if (!processedElection.resultsEmailSentAt) {
    throw new Error("Election results processor did not record resultsEmailSentAt.");
  }

  const logoutResult = await request("/auth/logout", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      refreshToken,
    }),
  });
  assertStatus(logoutResult, 200, "POST /auth/logout");

  console.log(
    JSON.stringify(
      {
        ok: true,
        testedEndpoints: [
          "GET /schools",
          "GET /schools/:schoolId/faculties",
          "GET /schools/:schoolId/faculties/:facultyId/programmes",
          "POST /auth/register",
          "POST /auth/verify-email",
          "GET /students/:userId",
          "GET /elections/active",
          "GET /elections/schedule",
          "GET /elections/statistics",
          "GET /notifications/:userId",
          "GET /news/trending",
          "GET /elections/:electionId/categories",
          "GET /elections/:electionId/aspirants",
          "POST /votes/verify-pin",
          "POST /votes/cast",
          "GET /categories/:categoryId/results",
          "GET /elections/results",
          "POST /auth/forgot-password",
          "POST /auth/verify-otp",
          "POST /auth/reset-password",
          "POST /auth/login",
          "POST /auth/check-tokens",
          "POST /auth/logout",
        ],
        resultsProcessor: processorResult,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exit(1);
});
