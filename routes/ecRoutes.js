import express from "express";
import {  registerEC } from "../controllers/authController.js";
import { loginEC, addECMember, listECMembers,  ecDashboard,   removeECMember,
  getCandidates } from "../controllers/ecController.js";
import { protect } from "../middleware/authEC.js";


const router = express.Router();

router.post("/register", registerEC);
router.post("/login", loginEC);

// ecRoutes.js
router.post("/add-member", protect, addECMember);
router.get("/list/:schoolId", protect, listECMembers);
router.get("/dashboard", protect, ecDashboard);
/** Remove EC Member */
router.delete("/:ecId", protect, removeECMember);  

/** Get all candidates for a school */
router.get("/candidates", protect, getCandidates);  

export default router;
