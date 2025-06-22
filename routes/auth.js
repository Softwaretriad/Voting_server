import { Router } from "express";
import { loginEC, registerEC } from "../controllers/authController.js";

const router = Router();

router.post("/register", registerEC);
router.post("/login", loginEC);

export default router;
