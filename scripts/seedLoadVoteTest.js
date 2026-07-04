import dotenv from "dotenv";
import mongoose from "mongoose";
import School from "../models/school.js";
import Student from "../models/Student.js";
import Election from "../models/Election.js";
import Aspirant from "../models/Aspirant.js";
import Vote from "../models/Vote.js";
import { signAccessToken } from "../utils/studentAuth.js";

dotenv.config();

const VOTER_COUNT = Number(process.env.LOAD_VOTE_SEED_VOTERS || 25);
const PASSWORD = process.env.LOAD_VOTE_SEED_PASSWORD || "LoadTest@123";
const VOTING_PIN = String(process.env.LOAD_VOTE_SEED_PIN || "1234");

const makeStamp = () => new Date().toISOString().replace(/[-:.TZ]/g, "");

const seed = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const stamp = makeStamp();
  const school = await School.create({
    name: `Load Test University ${stamp}`,
    fullName: `Load Test University ${stamp}`,
    shortName: "LTU",
    logoUrl: "https://placehold.co/200x200/png",
    email: `load-school-${stamp}@myunivote.test`,
    plan: "free",
    subscriptionTerm: "4_months",
    subscriptionStartedAt: new Date(),
    faculties: [
      {
        name: "Engineering",
        programmes: [{ name: "BSc Computer Science", durationYears: 4 }],
      },
    ],
  });

  const students = [];
  for (let index = 0; index < VOTER_COUNT; index += 1) {
    students.push({
      studentId: `LOAD-${stamp}-${String(index + 1).padStart(4, "0")}`,
      firstName: "Load",
      lastName: `Voter${index + 1}`,
      gender: index % 2 === 0 ? "female" : "male",
      email: `load-voter-${stamp}-${index + 1}@myunivote.test`,
      password: PASSWORD,
      phone: `+2332401${String(index + 1).padStart(5, "0")}`,
      schoolId: school._id,
      universityFullName: school.fullName,
      department: "Engineering",
      currentYearOfStudy: 3,
      programOfStudy: "BSc Computer Science",
      votingPin: VOTING_PIN,
      isEmailVerified: true,
    });
  }

  const createdStudents = [];
  for (const studentData of students) {
    createdStudents.push(await Student.create(studentData));
  }
  const election = await Election.create({
    schoolId: school._id,
    title: `Load Vote Election ${stamp}`,
    description: "Disposable election for k6 vote-write testing",
    subTitle: school.shortName,
    imageUrl: "https://placehold.co/600x300/png",
    startTime: new Date(Date.now() - 60 * 1000),
    endTime: new Date(Date.now() + 60 * 60 * 1000),
    status: "active",
    audience: { scope: "all_students" },
    categories: [{ title: "SRC President", subTitle: school.shortName }],
    candidates: [{ name: "Load Candidate A", position: "SRC President" }],
    totalVotes: 0,
  });

  const categoryId = election.categories[0]._id;
  const aspirant = await Aspirant.create({
    name: "Load Candidate A",
    studentId: `LOAD-ASP-${stamp}`,
    programmeOfStudy: "BSc Computer Science",
    level: "300",
    faculty: "Engineering",
    electoralCategory: "SRC President",
    schoolId: school._id,
    electionId: election._id,
    categoryId,
    imageUrl: "https://placehold.co/300x300/png",
    title: election.title,
    voteCount: 0,
  });

  await Vote.deleteMany({ electionId: election._id });

  const votersJson = createdStudents.map((student) => ({
    email: student.email,
    password: PASSWORD,
    studentId: student._id.toString(),
    token: signAccessToken(student),
    pin: VOTING_PIN,
  }));

  console.log("Load vote seed complete");
  console.log(`Voters: ${createdStudents.length}`);
  console.log(`ELECTION_ID=${election._id.toString()}`);
  console.log(`ASPIRANT_ID=${aspirant._id.toString()}`);
  console.log(`VUS=${Math.min(createdStudents.length, 50)}`);
  console.log(`ITERATIONS=${createdStudents.length}`);
  console.log(`VOTERS_JSON=${JSON.stringify(votersJson)}`);

  await mongoose.disconnect();
};

seed().catch(async (error) => {
  console.error("Load vote seed failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});
