import express from "express";
import { getTrendingNews } from "../controllers/newsController.js";
import { protectStudent } from "../middleware/authStudent.js";

const router = express.Router();

router.get("/trending", protectStudent, getTrendingNews);

export default router;
