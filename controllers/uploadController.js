import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import Aspirant from "../models/Aspirant.js";
import { sendError } from "../utils/apiResponse.js";
import { sanitizeUploadKey, uploadDirectory } from "../middleware/uploadImage.js";
import {
  buildAspirantImageUrl,
  getUploadedImagePath,
  listUploadedImageFilenames,
} from "../utils/aspirantImage.js";
import {
  buildElectionImageUrl,
  getElectionImagePath,
  listElectionImageFilenames,
} from "../utils/electionImage.js";
import { notifySchoolAdmins } from "../utils/notificationService.js";

const setStableImageCacheHeaders = (res) => {
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
};

const optimizeUploadedImage = async ({
  inputPath,
  outputPrefix,
  maxWidth,
  maxHeight,
}) => {
  const outputPath = path.join(uploadDirectory, `${outputPrefix}.webp`);

  await sharp(inputPath)
    .rotate()
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4 })
    .toFile(outputPath);

  await fs.unlink(inputPath).catch(() => null);
  return outputPath;
};

const resolveElectionClientKey = (req) => {
  const candidates = [
    req.body?.clientKey,
    req.body?.electionClientKey,
    req.body?.draftClientKey,
    req.query?.clientKey,
    req.query?.electionClientKey,
    req.get("x-client-key"),
    req.get("x-election-client-key"),
  ];

  return candidates
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
};

const removePreviousStudentUploads = async (studentId, currentFilename) => {
  const previousFilenames = (await listUploadedImageFilenames(studentId)).filter(
    (filename) => filename !== currentFilename
  );

  await Promise.all(
    previousFilenames.map((filename) =>
      fs.unlink(path.join(uploadDirectory, filename)).catch(() => null)
    )
  );

  return previousFilenames.length > 0;
};

const removePreviousElectionUploads = async ({ schoolId, clientKey, currentFilename }) => {
  const previousFilenames = (
    await listElectionImageFilenames(schoolId, clientKey)
  ).filter((filename) => filename !== currentFilename);

  await Promise.all(
    previousFilenames.map((filename) =>
      fs.unlink(path.join(uploadDirectory, filename)).catch(() => null)
    )
  );

  return previousFilenames.length > 0;
};

export const uploadAdminImage = async (req, res) => {
  try {
    if (!req.file) {
      sendError(res, 400, "Image file is required");
      return;
    }

    const studentId = String(req.body?.studentId || "").trim();
    const optimizedPath = await optimizeUploadedImage({
      inputPath: req.file.path,
      outputPrefix: path.parse(req.file.filename).name,
      maxWidth: 720,
      maxHeight: 720,
    });
    const filename = path.basename(optimizedPath);
    const optimizedStat = await fs.stat(optimizedPath);
    const replaced = await removePreviousStudentUploads(studentId, filename);
    const url = buildAspirantImageUrl(req, studentId);
    let updatedAspirants = 0;

    if (studentId) {
      const updateResult = await Aspirant.updateMany(
        { schoolId: req.schoolId, studentId },
        { $set: { imageUrl: url } }
      );
      updatedAspirants = updateResult.modifiedCount || 0;
    }

    const aspirant = studentId
      ? await Aspirant.findOne({ schoolId: req.schoolId, studentId }).select("name")
      : null;

    await notifySchoolAdmins({
      schoolId: req.schoolId,
      type: "aspirant_image_uploaded",
      title: "Aspirant image uploaded",
      message: aspirant?.name
        ? `An image was uploaded for ${aspirant.name}.`
        : "An aspirant image was uploaded successfully.",
      priority: "low",
      data: {
        studentId,
        aspirantName: aspirant?.name || "",
        imageUrl: url,
      },
    });

    res.status(201).json({
      message: "Image uploaded successfully",
      studentId,
      clientKey: String(req.body?.clientKey || "").trim(),
      originalName: req.file.originalname,
      mimeType: "image/webp",
      size: optimizedStat.size,
      replaced,
      updatedAspirants,
      url,
    });
  } catch (error) {
    sendError(res, 500, "Unable to upload image");
  }
};

export const uploadElectionImage = async (req, res) => {
  try {
    if (!req.file) {
      sendError(res, 400, "Image file is required");
      return;
    }

    const clientKey = resolveElectionClientKey(req);
    if (!clientKey) {
      await fs.unlink(req.file.path).catch(() => null);
      sendError(
        res,
        400,
        "clientKey is required",
        {
          acceptedFields: [
            "clientKey",
            "electionClientKey",
            "draftClientKey",
          ],
          acceptedHeaders: ["x-client-key", "x-election-client-key"],
          acceptedQuery: ["clientKey", "electionClientKey"],
        }
      );
      return;
    }

    const safeSchoolId = sanitizeUploadKey(req.schoolId);
    const safeClientKey = sanitizeUploadKey(clientKey);
    const filenamePrefix = `election-${safeSchoolId}-${safeClientKey}-${Date.now()}`;
    const optimizedPath = await optimizeUploadedImage({
      inputPath: req.file.path,
      outputPrefix: filenamePrefix,
      maxWidth: 1600,
      maxHeight: 900,
    });
    const filename = path.basename(optimizedPath);
    const optimizedStat = await fs.stat(optimizedPath);

    const replaced = await removePreviousElectionUploads({
      schoolId: req.schoolId,
      clientKey,
      currentFilename: filename,
    });
    const stableUrl = buildElectionImageUrl(req, req.schoolId, clientKey);

    await notifySchoolAdmins({
      schoolId: req.schoolId,
      type: "election_image_uploaded",
      title: "Election image uploaded",
      message: "An election image was uploaded successfully.",
      priority: "low",
      data: {
        clientKey,
        imageUrl: stableUrl,
      },
    });

    res.status(201).json({
      message: "Election image uploaded successfully",
      clientKey,
      originalName: req.file.originalname,
      mimeType: "image/webp",
      size: optimizedStat.size,
      replaced,
      url: stableUrl,
    });
  } catch (error) {
    sendError(res, 500, "Unable to upload election image");
  }
};

export const getUploadedImageByStudentId = async (req, res) => {
  try {
    const studentId = String(req.params?.studentId || "").trim();
    const imagePath = await getUploadedImagePath(studentId);

    if (!imagePath) {
      sendError(res, 404, "Image not found");
      return;
    }

    setStableImageCacheHeaders(res);
    res.sendFile(imagePath);
  } catch (error) {
    sendError(res, 500, "Unable to load image");
  }
};

export const getUploadedElectionImage = async (req, res) => {
  try {
    const schoolId = String(req.params?.schoolId || "").trim();
    const clientKey = String(req.params?.clientKey || "").trim();
    const imagePath = await getElectionImagePath(schoolId, clientKey);

    if (!imagePath) {
      sendError(res, 404, "Image not found");
      return;
    }

    setStableImageCacheHeaders(res);
    res.sendFile(imagePath);
  } catch (error) {
    sendError(res, 500, "Unable to load image");
  }
};

export const handleImageUploadError = (error, _req, res, next) => {
  if (!error) {
    next();
    return;
  }

  if (error.code === "LIMIT_FILE_SIZE") {
    sendError(res, 400, "Image must be 5MB or smaller");
    return;
  }

  sendError(res, 400, error.message || "Invalid image upload");
};
