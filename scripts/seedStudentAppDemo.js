import dotenv from "dotenv";
import mongoose from "mongoose";
import School from "../models/school.js";
import Student from "../models/Student.js";
import Election from "../models/Election.js";
import Candidate from "../models/candidates.js";
import Notification from "../models/Notification.js";
import News from "../models/News.js";

dotenv.config();

const seed = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const stamp = Date.now();
  const schoolEmail = `demo-school-${stamp}@example.com`;
  const studentEmail = `demo-student-${stamp}@example.com`;

  const school = await School.create({
    name: "University of Ghana",
    fullName: "University of Ghana",
    shortName: "UG",
    logoUrl: "https://placehold.co/200x200/png",
    email: schoolEmail,
    plan: "premium",
    faculties: [
      {
        name: "Faculty of Engineering",
        programmes: [
          { name: "BSc Computer Science", durationYears: 4 },
          { name: "BSc Biomedical Engineering", durationYears: 4 },
        ],
      },
    ],
  });

  const student = await Student.create({
    studentId: "UG-DEMO-001",
    firstName: "Ada",
    lastName: "Mensah",
    gender: "female",
    email: studentEmail,
    password: "password123",
    phone: "+233240000000",
    schoolId: school._id,
    universityFullName: school.fullName,
    department: "Faculty of Engineering",
    currentYearOfStudy: 3,
    programOfStudy: "BSc Computer Science",
    votingPin: 1234,
    isEmailVerified: true,
  });

  const election = await Election.create({
    schoolId: school._id,
    title: "SRC Presidential Election",
    description: "Annual student leadership election",
    subTitle: school.shortName,
    imageUrl: "https://placehold.co/600x300/png",
    startTime: new Date(Date.now() - 60 * 60 * 1000),
    endTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
    status: "active",
    categories: [{ title: "SRC President", subTitle: school.shortName }],
    candidates: [
      { name: "Kwame Boateng", position: "SRC President" },
      { name: "Efua Owusu", position: "SRC President" },
    ],
  });

  const categoryId = election.categories[0]._id;

  await Candidate.insertMany([
    {
      name: "Kwame Boateng",
      position: "SRC President",
      schoolId: school._id,
      electionId: election._id,
      categoryId,
      department: "Faculty of Engineering",
      imageUrl: "https://placehold.co/300x300/png",
      title: election.title,
      voteCount: 12,
    },
    {
      name: "Efua Owusu",
      position: "SRC President",
      schoolId: school._id,
      electionId: election._id,
      categoryId,
      department: "Faculty of Engineering",
      imageUrl: "https://placehold.co/300x300/png",
      title: election.title,
      voteCount: 9,
    },
  ]);

  await Notification.create({
    studentId: student._id,
    title: "Election Starts Today",
    message: "Voting is now open for the SRC Presidential Election.",
    isRead: false,
  });

  await News.create({
    schoolId: school._id,
    title: "Demo Campus Debate Draws Big Crowd",
    description:
      "Students turned out in strong numbers for the pre-election debate on campus.",
    imageUrl: "https://placehold.co/640x360/png",
    publishedAt: new Date(),
    isTrending: true,
  });

  console.log("Demo seed complete");
  console.log(`Student email: ${student.email}`);
  console.log("Student password: password123");
  console.log("Student voting PIN: 1234");

  await mongoose.disconnect();
};

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
