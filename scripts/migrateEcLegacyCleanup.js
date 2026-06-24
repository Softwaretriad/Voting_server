import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const renameField = async (collection, from, to) =>
  collection.updateMany(
    { [from]: { $exists: true } },
    {
      $rename: {
        [from]: to,
      },
    }
  );

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const db = mongoose.connection.db;
  const results = {};

  results.studentsRole = await db
    .collection("students")
    .updateMany({ accountRole: "admin" }, { $set: { accountRole: "ec" } });
  results.studentsAssignedAt = await renameField(
    db.collection("students"),
    "adminAssignedAt",
    "ecAssignedAt"
  );
  results.studentsAssignedBy = await renameField(
    db.collection("students"),
    "adminAssignedBy",
    "ecAssignedBy"
  );

  results.notificationsRecipient = await db
    .collection("notifications")
    .updateMany({ recipientType: "admin" }, { $set: { recipientType: "ec" } });
  results.notificationsRecipientId = await renameField(
    db.collection("notifications"),
    "adminId",
    "ecUserId"
  );

  results.pushDevicesRecipient = await db
    .collection("pushdevices")
    .updateMany({ recipientType: "admin" }, { $set: { recipientType: "ec" } });

  results.activityActor = await db
    .collection("activitylogs")
    .updateMany({ actorType: "admin" }, { $set: { actorType: "ec" } });

  results.votesEcUserId = await db.collection("votes").updateMany(
    { adminId: { $exists: true }, ecUserId: { $exists: false } },
    [{ $set: { ecUserId: "$adminId" } }]
  );
  results.votesUnsetAdminId = await db
    .collection("votes")
    .updateMany({ adminId: { $exists: true } }, { $unset: { adminId: "" } });

  results.electionEmbeddedVotesEcUserId = await db.collection("elections").updateMany(
    { "votes.adminId": { $exists: true } },
    [{ $set: { votes: { $map: {
      input: "$votes",
      as: "vote",
      in: {
        $mergeObjects: [
          "$$vote",
          {
            ecUserId: {
              $ifNull: ["$$vote.ecUserId", "$$vote.adminId"],
            },
          },
        ],
      },
    } } } }]
  );
  results.electionEmbeddedVotesUnsetAdminId = await db
    .collection("elections")
    .updateMany(
      { "votes.adminId": { $exists: true } },
      { $unset: { "votes.$[].adminId": "" } }
    );

  console.log(
    Object.fromEntries(
      Object.entries(results).map(([key, result]) => [
        key,
        {
          matched: result.matchedCount,
          modified: result.modifiedCount,
        },
      ])
    )
  );

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("EC legacy cleanup migration failed:", error);
  await mongoose.disconnect().catch(() => null);
  process.exit(1);
});
