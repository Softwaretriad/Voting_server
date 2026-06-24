import express from "express";
import { addECMember, listECMembers, removeECMember } from "../controllers/ecController.js";
import { protect } from "../middleware/authEC.js";


const router = express.Router();

router.post("/add-member", protect, addECMember);
router.get("/list/:schoolId", protect, listECMembers);
/** Remove EC Member */
router.delete("/:ecId", protect, removeECMember);  

export default router;
