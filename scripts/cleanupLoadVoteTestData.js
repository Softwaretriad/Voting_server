import dotenv from "dotenv";
import mongoose from "mongoose";
import ActivityLog from "../models/ActivityLog.js";
import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import Notification from "../models/Notification.js";
import PushDevice from "../models/PushDevice.js";
import School from "../models/school.js";
import Student from "../models/Student.js";
import Vote from "../models/Vote.js";
import VoteSideEffectJob from "../models/VoteSideEffectJob.js";

dotenv.config();

const confirmed =
  process.env.LOAD_VOTE_CLEANUP_CONFIRM === "delete-load-vote-data" ||
  process.env.CLEANUP_CONFIRM === "delete-load-vote-data";

const getElectionIdValues = (electionIds) => [
  ...electionIds,
  ...electionIds.map((id) => id.toString()),
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const schools = await School.find({
    $or: [
      { name: /^Load Test University / },
      { email: /^load-school-/ },
    ],
  }).select("_id name email");
  const schoolIds = schools.map((school) => school._id);

  const elections = await Election.find({
    $or: [
      { schoolId: { $in: schoolIds } },
      { title: /^Load Vote Election / },
    ],
  }).select("_id title schoolId");
  const electionIds = elections.map((election) => election._id);
  const electionIdValues = getElectionIdValues(electionIds);

  const students = await Student.find({
    $or: [
      { schoolId: { $in: schoolIds } },
      { email: /^load-voter-/ },
      { studentId: /^LOAD-/ },
    ],
  }).select("_id email studentId");
  const studentIds = students.map((student) => student._id);

  const summary = {
    schools: schoolIds.length,
    elections: electionIds.length,
    students: studentIds.length,
    aspirants: await Aspirant.countDocuments({
      $or: [{ schoolId: { $in: schoolIds } }, { electionId: { $in: electionIds } }],
    }),
    votes: await Vote.countDocuments({
      $or: [
        { schoolId: { $in: schoolIds } },
        { electionId: { $in: electionIds } },
        { voterId: { $in: studentIds } },
      ],
    }),
    pushDevices: await PushDevice.countDocuments({
      $or: [
        { schoolId: { $in: schoolIds } },
        { recipientId: { $in: studentIds } },
      ],
    }),
    notifications: await Notification.countDocuments({
      $or: [
        { schoolId: { $in: schoolIds } },
        { studentId: { $in: studentIds } },
        { ecUserId: { $in: studentIds } },
        { "data.electionId": { $in: electionIdValues } },
      ],
    }),
    voteSideEffectJobs: await VoteSideEffectJob.countDocuments({
      $or: [
        { schoolId: { $in: schoolIds } },
        { electionId: { $in: electionIds } },
        { voterId: { $in: studentIds } },
      ],
    }),
    activityLogs: await ActivityLog.countDocuments({
      $or: [
        { schoolId: { $in: schoolIds } },
        { actorId: { $in: studentIds } },
        { "metadata.electionId": { $in: electionIdValues } },
      ],
    }),
  };

  console.log("Load vote cleanup summary:", summary);

  if (!confirmed) {
    console.log(
      "Dry run only. Set LOAD_VOTE_CLEANUP_CONFIRM=delete-load-vote-data to delete."
    );
    await mongoose.disconnect();
    return;
  }

  await Promise.all([
    ActivityLog.deleteMany({
      $or: [
        { schoolId: { $in: schoolIds } },
        { actorId: { $in: studentIds } },
        { "metadata.electionId": { $in: electionIdValues } },
      ],
    }),
    VoteSideEffectJob.deleteMany({
      $or: [
        { schoolId: { $in: schoolIds } },
        { electionId: { $in: electionIds } },
        { voterId: { $in: studentIds } },
      ],
    }),
    Notification.deleteMany({
      $or: [
        { schoolId: { $in: schoolIds } },
        { studentId: { $in: studentIds } },
        { ecUserId: { $in: studentIds } },
        { "data.electionId": { $in: electionIdValues } },
      ],
    }),
    PushDevice.deleteMany({
      $or: [
        { schoolId: { $in: schoolIds } },
        { recipientId: { $in: studentIds } },
      ],
    }),
    Vote.deleteMany({
      $or: [
        { schoolId: { $in: schoolIds } },
        { electionId: { $in: electionIds } },
        { voterId: { $in: studentIds } },
      ],
    }),
    Aspirant.deleteMany({
      $or: [{ schoolId: { $in: schoolIds } }, { electionId: { $in: electionIds } }],
    }),
  ]);

  await Election.deleteMany({ _id: { $in: electionIds } });
  await Student.deleteMany({ _id: { $in: studentIds } });
  await School.deleteMany({ _id: { $in: schoolIds } });

  console.log("Deleted load vote test data.");
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Load vote cleanup failed:", error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
