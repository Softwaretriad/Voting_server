import express from "express";
import {
  getUploadedElectionImage,
  getUploadedImageByStudentId,
} from "../controllers/uploadController.js";

const router = express.Router();

router.get("/images/:studentId", getUploadedImageByStudentId);
router.get("/election-images/:schoolId/:clientKey", getUploadedElectionImage);

export default router;
