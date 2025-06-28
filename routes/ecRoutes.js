import express from "express";
import {  registerEC } from "../controllers/authController.js";
import { loginEC, addECMember, listECMembers } from "../controllers/ecController.js";
import { protect } from "../middleware/authEC.js";


const router = express.Router();

router.post("/register", registerEC);
router.post("/login", loginEC);

// ecRoutes.js
router.post("/add-member", protect, addECMember);
router.get("/list/:schoolId", protect, listECMembers);

export default router;
