import fs from "fs/promises";
import path from "path";
import { sanitizeUploadKey, uploadDirectory } from "../middleware/uploadImage.js";

const buildElectionImagePrefix = (schoolId, clientKey) =>
  `election-${sanitizeUploadKey(schoolId)}-${sanitizeUploadKey(clientKey)}-`;

export const buildElectionImageUrl = (req, schoolId, clientKey) => {
  const origin = `${req.protocol}://${req.get("host")}`;
  return `${origin}/uploads/election-images/${encodeURIComponent(
    schoolId
  )}/${encodeURIComponent(clientKey)}`;
};

export const listElectionImageFilenames = async (schoolId, clientKey) => {
  const normalizedSchoolId = sanitizeUploadKey(schoolId);
  const normalizedClientKey = sanitizeUploadKey(clientKey);

  if (
    !schoolId ||
    !clientKey ||
    normalizedSchoolId === "image" ||
    normalizedClientKey === "image"
  ) {
    return [];
  }

  const filenames = await fs.readdir(uploadDirectory);
  const prefix = buildElectionImagePrefix(schoolId, clientKey);

  return filenames.filter((filename) => filename.startsWith(prefix)).sort((a, b) => b.localeCompare(a));
};

export const getElectionImagePath = async (schoolId, clientKey) => {
  const filenames = await listElectionImageFilenames(schoolId, clientKey);
  if (!filenames[0]) {
    return null;
  }

  return path.join(uploadDirectory, filenames[0]);
};

