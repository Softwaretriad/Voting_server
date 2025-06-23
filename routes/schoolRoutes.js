import express from "express";
import { createSchool, checkSubscription } from "../controllers/schoolController.js";

const router = express.Router();

// Create a new school
router.post("/create", createSchool);

// Check school subscription status
router.get("/subscription/:schoolId", checkSubscription);

export default router;
