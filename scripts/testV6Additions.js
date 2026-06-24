import dotenv from "dotenv";
import mongoose from "mongoose";
import School from "../models/school.js";
import Student from "../models/Student.js";
import { hashSecret } from "../utils/security.js";

dotenv.config();

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:5000";
const stamp = Date.now();

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
  } catch {
    body = text;
  }

  return { status: response.status, body };
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
    throw new Error("No school found for testing. Run the demo seed first.");
  }

  const faculty = school.faculties[0];
  const programme = faculty.programmes[0];

  let ecUser = await Student.findOne({
    email: "ec-v6@example.com",
    accountRole: "ec",
  });
  if (!ecUser) {
    ecUser = await Student.create({
      studentId: `EC-V6-${stamp}`,
      firstName: "EC",
      lastName: "V6",
      gender: "male",
      email: "ec-v6@example.com",
      password: "Password@123",
      schoolId: school._id,
      phone: "+233240000100",
      universityFullName: school.fullName || school.name,
      department: faculty.name,
      currentYearOfStudy: 4,
      programOfStudy: programme.name,
      votingPin: "1234",
      accountRole: "ec",
      isVerified: true,
    });
  }

  const studentEmail = `v6-student-${stamp}@example.com`;
  const studentPassword = "Password@123";
  const emailOtp = "123456";
  const votingPinOtp = "654321";

  const registerResult = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      studentId: `V6-${stamp}`,
      firstName: "V6",
      lastName: "Tester",
      gender: "male",
      email: studentEmail,
      password: studentPassword,
      phone: "+233240000999",
      universityFullName: school.fullName || school.name,
      department: faculty.name,
      currentYearOfStudy: 2,
      programOfStudy: programme.name,
      votingPin: 1234,
    }),
  });
  assertStatus(registerResult, 201, "POST /auth/register");

  const student = await Student.findOne({ email: studentEmail });
  student.emailVerificationOtp = await hashSecret(emailOtp);
  student.emailVerificationOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
  await student.save();

  const verifyResult = await request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({
      email: studentEmail,
      otp: emailOtp,
    }),
  });
  assertStatus(verifyResult, 200, "POST /auth/verify-email");

  const forgotPinMissingResult = await request("/votes/pin/forgot", {
    method: "POST",
    body: JSON.stringify({ email: `missing-${stamp}@example.com` }),
  });
  assertStatus(forgotPinMissingResult, 200, "POST /votes/pin/forgot missing email");

  const forgotPinResult = await request("/votes/pin/forgot", {
    method: "POST",
    body: JSON.stringify({ email: studentEmail }),
  });
  assertStatus(forgotPinResult, 200, "POST /votes/pin/forgot");

  const refreshedStudent = await Student.findOne({ email: studentEmail });
  refreshedStudent.votingPinResetOtp = await hashSecret(votingPinOtp);
  refreshedStudent.votingPinResetOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
  await refreshedStudent.save();
  const verifyPinOtpResult = await request("/votes/pin/verify-otp", {
    method: "POST",
    body: JSON.stringify({
      email: studentEmail,
      otp: votingPinOtp,
    }),
  });
  assertStatus(verifyPinOtpResult, 200, "POST /votes/pin/verify-otp");

  const resetPinResult = await request("/votes/pin/reset", {
    method: "POST",
    body: JSON.stringify({
      resetToken: verifyPinOtpResult.body.resetToken,
      newPin: 5678,
    }),
  });
  assertStatus(resetPinResult, 200, "POST /votes/pin/reset");

  const loginAdminResult = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "ec-v6@example.com",
      password: "Password@123",
    }),
  });
  assertStatus(loginAdminResult, 200, "POST /auth/login EC");
  const ecToken = loginAdminResult.body.token;

  const ecHeaders = {
    Authorization: `Bearer ${ecToken}`,
  };

  const dashboardResult = await request(`/ec/dashboard/${school._id}`, {
    headers: ecHeaders,
  });
  assertStatus(dashboardResult, 200, "GET /ec/dashboard/:schoolId");

  const createElectionResult = await request("/ec/elections", {
    method: "POST",
    headers: ecHeaders,
    body: JSON.stringify({
      title: `Draft Election ${stamp}`,
      startDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      endDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      categories: ["SRC President", "General Secretary"],
      status: "draft",
    }),
  });
  assertStatus(createElectionResult, 201, "POST /ec/elections");
  const electionId = createElectionResult.body._id;

  const getDraftsResult = await request("/ec/elections?status=draft", {
    headers: ecHeaders,
  });
  assertStatus(getDraftsResult, 200, "GET /ec/elections?status=draft");

  const updateElectionResult = await request(`/ec/elections/${electionId}`, {
    method: "PUT",
    headers: ecHeaders,
    body: JSON.stringify({
      title: `Updated Draft Election ${stamp}`,
      categories: ["SRC President"],
    }),
  });
  assertStatus(updateElectionResult, 200, "PUT /ec/elections/:electionId");

  const scheduleElectionResult = await request(`/ec/elections/${electionId}/schedule`, {
    method: "PATCH",
    headers: ecHeaders,
  });
  assertStatus(scheduleElectionResult, 200, "PATCH /ec/elections/:electionId/schedule");

  const getScheduledResult = await request("/ec/elections?status=scheduled", {
    headers: ecHeaders,
  });
  assertStatus(getScheduledResult, 200, "GET /ec/elections?status=scheduled");

  const reportsResult = await request(`/ec/reports/${school._id}`, {
    headers: ecHeaders,
  });
  assertStatus(reportsResult, 200, "GET /ec/reports/:schoolId");

  const detailedReportResult = await request(`/ec/reports/elections/${electionId}`, {
    headers: ecHeaders,
  });
  assertStatus(
    detailedReportResult,
    200,
    "GET /ec/reports/elections/:electionId"
  );

  const activityResult = await request(`/ec/activity/${school._id}`, {
    headers: ecHeaders,
  });
  assertStatus(activityResult, 200, "GET /ec/activity/:schoolId");

  const createDeleteCandidate = await request("/ec/elections", {
    method: "POST",
    headers: ecHeaders,
    body: JSON.stringify({
      title: `Delete Draft ${stamp}`,
      startDate: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      endDate: new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString(),
      categories: ["Treasurer"],
      status: "draft",
    }),
  });
  assertStatus(createDeleteCandidate, 201, "POST /ec/elections second draft");

  const deleteResult = await request(`/ec/elections/${createDeleteCandidate.body._id}`, {
    method: "DELETE",
    headers: ecHeaders,
  });
  assertStatus(deleteResult, 200, "DELETE /ec/elections/:electionId");

  console.log(
    JSON.stringify(
      {
        ok: true,
        tested: [
          "POST /votes/pin/forgot",
          "POST /votes/pin/verify-otp",
          "POST /votes/pin/reset",
          "POST /auth/login EC",
          "GET /ec/dashboard/:schoolId",
          "GET /ec/elections?status=draft",
          "POST /ec/elections",
          "PUT /ec/elections/:electionId",
          "PATCH /ec/elections/:electionId/schedule",
          "GET /ec/elections?status=scheduled",
          "GET /ec/reports/:schoolId",
          "GET /ec/reports/elections/:electionId",
          "GET /ec/activity/:schoolId",
          "DELETE /ec/elections/:electionId",
        ],
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
