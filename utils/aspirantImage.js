import fs from "fs/promises";
import path from "path";
import { sanitizeUploadKey, uploadDirectory } from "../middleware/uploadImage.js";

export const buildAspirantImageUrl = (req, studentId) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  return `${origin}/uploads/images/${encodeURIComponent(studentId)}`;
};

export const buildAspirantImageFileUrl = (req, filename) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  return `${origin}/uploads/images/files/${encodeURIComponent(filename)}`;
};

export const getUploadedImageFilePath = async (filename) => {
  const safeFilename = path.basename(String(filename || "").trim());
  if (!safeFilename || safeFilename !== String(filename || "").trim()) {
    return null;
  }

  const imagePath = path.join(uploadDirectory, safeFilename);
  try {
    await fs.access(imagePath);
    return imagePath;
  } catch {
    return null;
  }
};

export const listUploadedImageFilenames = async (studentId) => {
  const normalizedStudentId = sanitizeUploadKey(studentId);
  if (!studentId || normalizedStudentId === "image") {
    return [];
  }

  const filenames = await fs.readdir(uploadDirectory);
  return filenames
    .filter((filename) => filename.startsWith(`${normalizedStudentId}-`))
    .sort((a, b) => b.localeCompare(a));
};

export const getUploadedImagePath = async (studentId) => {
  const filenames = await listUploadedImageFilenames(studentId);
  if (!filenames[0]) {
    return null;
  }

  return path.join(uploadDirectory, filenames[0]);
};

export const hasUploadedImage = async (studentId) => {
  const imagePath = await getUploadedImagePath(studentId);
  return Boolean(imagePath);
};
