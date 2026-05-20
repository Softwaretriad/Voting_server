import express from "express";
import { inviteECMembers } from "../controllers/authController.js";
import { addECMember, listECMembers, removeECMember } from "../controllers/ecController.js";
import { protect } from "../middleware/authEC.js";
import { validate, validators } from "../middleware/validate.js";


const router = express.Router();

router.post("/invite-members", protect, validate(validators.inviteAdminMembers), inviteECMembers);
router.post("/add-member", protect, addECMember);
router.get("/list/:schoolId", protect, listECMembers);
/** Remove EC Member */
router.delete("/:ecId", protect, removeECMember);  

export default router;
