import dotenv from "dotenv";
import mongoose from "mongoose";
import School from "../models/school.js";
import Student from "../models/Student.js";
import Election from "../models/Election.js";
import Aspirant from "../models/Aspirant.js";
import Notification from "../models/Notification.js";
import Voter from "../models/Voter.js";

dotenv.config();

const DEMO_SCHOOL_EMAIL = "review-demo-school@myunivote.demo";
const REVIEW_STUDENT_EMAIL = "review.student@myunivote.demo";
const REVIEW_ADMIN_EMAIL = "review.admin@myunivote.demo";
const REVIEW_PASSWORD = "Review@123";
const REVIEW_VOTING_PIN = "1234";

const upsertStudentAccount = async ({ email, updates }) => {
  const existing = await Student.findOne({ email });

  if (existing) {
    Object.assign(existing, updates);
    existing.password = updates.password;
    existing.votingPin = updates.votingPin;
    await existing.save();
    return existing;
  }

  const created = await Student.create(updates);
  return created;
};

const seed = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const school = await School.findOneAndUpdate(
    { email: DEMO_SCHOOL_EMAIL },
    {
      name: "MyUniVote Review University",
      fullName: "MyUniVote Review University",
      shortName: "MRU",
      logoUrl: "https://placehold.co/200x200/png",
      email: DEMO_SCHOOL_EMAIL,
      plan: "free",
      subscriptionTerm: "4_months",
      subscriptionStartedAt: new Date(),
      faculties: [
        {
          name: "Faculty of Engineering",
          programmes: [
            { name: "BSc Computer Science", durationYears: 4 },
            { name: "BSc Information Technology", durationYears: 4 },
          ],
        },
      ],
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );

  const reviewStudent = await upsertStudentAccount({
    email: REVIEW_STUDENT_EMAIL,
    updates: {
      studentId: "MRU-REVIEW-STUDENT",
      firstName: "Review",
      lastName: "Student",
      gender: "female",
      email: REVIEW_STUDENT_EMAIL,
      password: REVIEW_PASSWORD,
      phone: "+233240000111",
      schoolId: school._id,
      universityFullName: school.fullName,
      department: "Faculty of Engineering",
      currentYearOfStudy: 3,
      programOfStudy: "BSc Computer Science",
      votingPin: REVIEW_VOTING_PIN,
      isEmailVerified: true,
      accountRole: "student",
      ecAssignedAt: null,
      ecAssignedBy: null,
    },
  });

  const reviewAdmin = await upsertStudentAccount({
    email: REVIEW_ADMIN_EMAIL,
    updates: {
      studentId: "MRU-REVIEW-ADMIN",
      firstName: "Review",
      lastName: "Admin",
      gender: "male",
      email: REVIEW_ADMIN_EMAIL,
      password: REVIEW_PASSWORD,
      phone: "+233240000222",
      schoolId: school._id,
      universityFullName: school.fullName,
      department: "Faculty of Engineering",
      currentYearOfStudy: 4,
      programOfStudy: "BSc Information Technology",
      votingPin: REVIEW_VOTING_PIN,
      isEmailVerified: true,
      accountRole: "ec",
      ecAssignedAt: new Date(),
      ecAssignedBy: null,
    },
  });

  const seededElectionTitles = [
    "Review Demo Active Election",
    "Review Demo Scheduled Election",
    "Review Demo Closed Election",
  ];
  const existingElectionIds = (
    await Election.find({
      schoolId: school._id,
      title: { $in: seededElectionTitles },
    }).select("_id")
  ).map((election) => election._id);

  if (existingElectionIds.length > 0) {
    await Promise.all([
      Aspirant.deleteMany({ electionId: { $in: existingElectionIds } }),
      Voter.deleteMany({ electionId: { $in: existingElectionIds } }),
      Election.deleteMany({ _id: { $in: existingElectionIds } }),
    ]);
  }

  const now = Date.now();

  const activeElection = await Election.create({
    schoolId: school._id,
    title: "Review Demo Active Election",
    description: "Live election for reviewer access",
    subTitle: school.shortName,
    imageUrl: "https://placehold.co/600x300/png",
    startTime: new Date(now - 60 * 60 * 1000),
    endTime: new Date(now + 24 * 60 * 60 * 1000),
    status: "active",
    categories: [
      { title: "President", subTitle: school.shortName },
      { title: "General Secretary", subTitle: school.shortName },
    ],
    candidates: [
      { name: "Amina Owusu", position: "President" },
      { name: "Kojo Mensah", position: "President" },
      { name: "Esi Boateng", position: "General Secretary" },
      { name: "Yaw Asare", position: "General Secretary" },
    ],
    eligibleVoters: [
      {
        name: "Review Student",
        studentId: reviewStudent.studentId,
        programmeOfStudy: reviewStudent.programOfStudy,
        level: String(reviewStudent.currentYearOfStudy),
        faculty: reviewStudent.department,
      },
      {
        name: "Review Admin",
        studentId: reviewAdmin.studentId,
        programmeOfStudy: reviewAdmin.programOfStudy,
        level: String(reviewAdmin.currentYearOfStudy),
        faculty: reviewAdmin.department,
      },
    ],
  });

  const scheduledElection = await Election.create({
    schoolId: school._id,
    title: "Review Demo Scheduled Election",
    description: "Scheduled election for reviewer access",
    subTitle: school.shortName,
    imageUrl: "https://placehold.co/600x300/png",
    startTime: new Date(now + 24 * 60 * 60 * 1000),
    endTime: new Date(now + 48 * 60 * 60 * 1000),
    status: "scheduled",
    categories: [{ title: "Treasurer", subTitle: school.shortName }],
    candidates: [{ name: "Scheduled Candidate", position: "Treasurer" }],
    eligibleVoters: [
      {
        name: "Review Student",
        studentId: reviewStudent.studentId,
        programmeOfStudy: reviewStudent.programOfStudy,
        level: String(reviewStudent.currentYearOfStudy),
        faculty: reviewStudent.department,
      },
    ],
  });

  const closedElection = await Election.create({
    schoolId: school._id,
    title: "Review Demo Closed Election",
    description: "Closed election for reviewer access",
    subTitle: school.shortName,
    imageUrl: "https://placehold.co/600x300/png",
    startTime: new Date(now - 7 * 24 * 60 * 60 * 1000),
    endTime: new Date(now - 6 * 24 * 60 * 60 * 1000),
    status: "closed",
    categories: [{ title: "Welfare Officer", subTitle: school.shortName }],
    candidates: [
      { name: "Closed Winner", position: "Welfare Officer" },
      { name: "Closed Runner-Up", position: "Welfare Officer" },
    ],
    eligibleVoters: [
      {
        name: "Review Student",
        studentId: reviewStudent.studentId,
        programmeOfStudy: reviewStudent.programOfStudy,
        level: String(reviewStudent.currentYearOfStudy),
        faculty: reviewStudent.department,
      },
    ],
  });

  await Voter.insertMany([
    {
      schoolId: school._id,
      electionId: activeElection._id,
      name: "Review Student",
      studentId: reviewStudent.studentId,
      programmeOfStudy: reviewStudent.programOfStudy,
      level: String(reviewStudent.currentYearOfStudy),
      faculty: reviewStudent.department,
      email: reviewStudent.email,
    },
    {
      schoolId: school._id,
      electionId: activeElection._id,
      name: "Review Admin",
      studentId: reviewAdmin.studentId,
      programmeOfStudy: reviewAdmin.programOfStudy,
      level: String(reviewAdmin.currentYearOfStudy),
      faculty: reviewAdmin.department,
      email: reviewAdmin.email,
    },
    {
      schoolId: school._id,
      electionId: scheduledElection._id,
      name: "Review Student",
      studentId: reviewStudent.studentId,
      programmeOfStudy: reviewStudent.programOfStudy,
      level: String(reviewStudent.currentYearOfStudy),
      faculty: reviewStudent.department,
      email: reviewStudent.email,
    },
    {
      schoolId: school._id,
      electionId: closedElection._id,
      name: "Review Student",
      studentId: reviewStudent.studentId,
      programmeOfStudy: reviewStudent.programOfStudy,
      level: String(reviewStudent.currentYearOfStudy),
      faculty: reviewStudent.department,
      email: reviewStudent.email,
    },
  ]);

  const [activePresidentCategory, activeSecretaryCategory] = activeElection.categories;
  const [closedCategory] = closedElection.categories;

  await Aspirant.insertMany([
    {
      name: "Amina Owusu",
      studentId: "MRU-ASP-001",
      programmeOfStudy: "BSc Computer Science",
      level: "300",
      faculty: "Faculty of Engineering",
      electoralCategory: "President",
      schoolId: school._id,
      electionId: activeElection._id,
      categoryId: activePresidentCategory._id,
      imageUrl: "https://placehold.co/300x300/png",
      title: activeElection.title,
      voteCount: 14,
    },
    {
      name: "Kojo Mensah",
      studentId: "MRU-ASP-002",
      programmeOfStudy: "BSc Computer Science",
      level: "300",
      faculty: "Faculty of Engineering",
      electoralCategory: "President",
      schoolId: school._id,
      electionId: activeElection._id,
      categoryId: activePresidentCategory._id,
      imageUrl: "https://placehold.co/300x300/png",
      title: activeElection.title,
      voteCount: 9,
    },
    {
      name: "Esi Boateng",
      studentId: "MRU-ASP-003",
      programmeOfStudy: "BSc Information Technology",
      level: "300",
      faculty: "Faculty of Engineering",
      electoralCategory: "General Secretary",
      schoolId: school._id,
      electionId: activeElection._id,
      categoryId: activeSecretaryCategory._id,
      imageUrl: "https://placehold.co/300x300/png",
      title: activeElection.title,
      voteCount: 11,
    },
    {
      name: "Yaw Asare",
      studentId: "MRU-ASP-004",
      programmeOfStudy: "BSc Information Technology",
      level: "300",
      faculty: "Faculty of Engineering",
      electoralCategory: "General Secretary",
      schoolId: school._id,
      electionId: activeElection._id,
      categoryId: activeSecretaryCategory._id,
      imageUrl: "https://placehold.co/300x300/png",
      title: activeElection.title,
      voteCount: 7,
    },
    {
      name: "Closed Winner",
      studentId: "MRU-ASP-005",
      programmeOfStudy: "BSc Computer Science",
      level: "300",
      faculty: "Faculty of Engineering",
      electoralCategory: "Welfare Officer",
      schoolId: school._id,
      electionId: closedElection._id,
      categoryId: closedCategory._id,
      imageUrl: "https://placehold.co/300x300/png",
      title: closedElection.title,
      voteCount: 25,
    },
    {
      name: "Closed Runner-Up",
      studentId: "MRU-ASP-006",
      programmeOfStudy: "BSc Information Technology",
      level: "300",
      faculty: "Faculty of Engineering",
      electoralCategory: "Welfare Officer",
      schoolId: school._id,
      electionId: closedElection._id,
      categoryId: closedCategory._id,
      imageUrl: "https://placehold.co/300x300/png",
      title: closedElection.title,
      voteCount: 17,
    },
  ]);

  await Notification.deleteMany({
    $or: [{ studentId: { $in: [reviewStudent._id, reviewAdmin._id] } }, { ecUserId: reviewAdmin._id }],
  });

  await Notification.insertMany([
    {
      recipientType: "student",
      studentId: reviewStudent._id,
      schoolId: school._id,
      type: "election_is_now_live",
      title: "Election is now live",
      message: "Review Demo Active Election is now live.",
      priority: "high",
      data: { electionId: activeElection._id.toString(), electionTitle: activeElection.title },
    },
    {
      recipientType: "ec",
      ecUserId: reviewAdmin._id,
      schoolId: school._id,
      type: "election_created",
      title: "Election created",
      message: "Review Demo Active Election was created successfully.",
      priority: "normal",
      data: { electionId: activeElection._id.toString(), electionTitle: activeElection.title },
    },
  ]);

  console.log("Review demo seed complete");
  console.log(`Student email: ${REVIEW_STUDENT_EMAIL}`);
  console.log(`Student password: ${REVIEW_PASSWORD}`);
  console.log(`Student voting PIN: ${REVIEW_VOTING_PIN}`);
  console.log(`Admin email: ${REVIEW_ADMIN_EMAIL}`);
  console.log(`Admin password: ${REVIEW_PASSWORD}`);

  await mongoose.disconnect();
};

seed().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
