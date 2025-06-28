// routes/schoolRoutes.js
import express from "express";
import { createSchool, checkSubscription } from "../controllers/schoolController.js";

const router = express.Router();

router.post("/register", createSchool);               
router.get("/subscription/:schoolId", checkSubscription); 

export default router;
