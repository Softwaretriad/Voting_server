import express from "express";
import {  registerEC } from "../controllers/authController.js";
import { addECMember, listECMembers, removeECMember } from "../controllers/ecController.js";
import { protect } from "../middleware/authEC.js";


const router = express.Router();

router.post("/register", registerEC);

// ecRoutes.js
router.post("/add-member", protect, addECMember);
router.get("/list/:schoolId", protect, listECMembers);
/** Remove EC Member */
router.delete("/:ecId", protect, removeECMember);  

export default router;
