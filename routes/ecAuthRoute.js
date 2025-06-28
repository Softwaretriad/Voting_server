import { Router } from "express";
import { registerEC } from "../controllers/authController.js";

const router = Router();

router.post("/register", registerEC);


export default router;
