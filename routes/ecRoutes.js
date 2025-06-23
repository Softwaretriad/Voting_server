import express from "express";
import {
  addECMember,
  listECMembers,
  loginEC
} from "../controllers/ecController.js";

const router = express.Router();

// Add a new EC member (max 5 per school)
router.post("/add-member", addECMember);

// Get list of EC members for a school
router.get("/list/:schoolId", listECMembers);

// EC login
router.post("/login", loginEC);

export default router;
