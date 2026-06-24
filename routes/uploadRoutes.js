import express from "express";
import {
  getUploadedElectionImage,
  getUploadedElectionImageFile,
  getUploadedImageFile,
  getUploadedImageByStudentId,
} from "../controllers/uploadController.js";

const router = express.Router();

router.get("/images/files/:filename", getUploadedImageFile);
router.get("/images/:studentId", getUploadedImageByStudentId);
router.get("/election-images/files/:filename", getUploadedElectionImageFile);
router.get("/election-images/:schoolId/:clientKey", getUploadedElectionImage);

export default router;
