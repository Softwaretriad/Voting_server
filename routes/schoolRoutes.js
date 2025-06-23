// routes/schoolRoutes.js
import express from "express";
import { createSchool, checkSubscription } from "../controllers/schoolController.js";

const router = express.Router();

router.post("/register", createSchool);               // POST /api/school/register
router.get("/subscription/:schoolId", checkSubscription); // GET /api/school/subscription/:schoolId

export default router;
