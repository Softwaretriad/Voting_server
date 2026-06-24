import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import Aspirant from "../models/Aspirant.js";
import Election from "../models/Election.js";
import { sendError } from "../utils/apiResponse.js";
import {
  sanitizeUploadKey,
  uploadTempDirectory,
} from "../middleware/uploadImage.js";
import { getUploadedImageFilePath, getUploadedImagePath } from "../utils/aspirantImage.js";
import { getElectionImageFilePath, getElectionImagePath } from "../utils/electionImage.js";
import {
  buildAspirantImageStoragePath,
  buildElectionImageStoragePath,
  uploadFileToFirebaseStorage,
} from "../utils/firebaseStorage.js";
import { notifySchoolAdmins } from "../utils/notificationService.js";

const allowedDecodedFormats = new Set(["jpeg", "png", "webp"]);
const maxInputPixels = Number(process.env.IMAGE_UPLOAD_MAX_PIXELS) || 40_000_000;
const maxInputDimension = Number(process.env.IMAGE_UPLOAD_MAX_DIMENSION) || 12_000;

const setStableImageCacheHeaders = (res) => {
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
  res.set("X-Content-Type-Options", "nosniff");
};

const removeFile = async (filePath) => {
  if (filePath) {
    await fs.unlink(filePath).catch(() => null);
  }
};

const isInvalidImageError = (error) =>
  /image|input buffer|pixel|dimension|format|page|corrupt|unsupported/i.test(
    error?.message || ""
  );

const validateUploadTextFields = (fields) => {
  const limits = {
    studentId: 80,
    clientKey: 128,
    electionClientKey: 128,
    draftClientKey: 128,
    aspirantId: 64,
    electionId: 64,
  };

  for (const [key, limit] of Object.entries(limits)) {
    if (fields?.[key] != null && String(fields[key]).length > limit) {
      return `${key} must be ${limit} characters or fewer`;
    }
  }
  return null;
};

const validateDecodedImage = async (inputPath) => {
  const metadata = await sharp(inputPath, {
    failOn: "error",
    limitInputPixels: maxInputPixels,
    sequentialRead: true,
  }).metadata();

  if (!allowedDecodedFormats.has(metadata.format)) {
    throw new Error("Decoded image format is not allowed");
  }
  if (!metadata.width || !metadata.height) {
    throw new Error("Image dimensions could not be read");
  }
  if (metadata.width > maxInputDimension || metadata.height > maxInputDimension) {
    throw new Error(`Image dimensions must not exceed ${maxInputDimension}px`);
  }
  if ((metadata.pages || 1) !== 1) {
    throw new Error("Animated or multi-page images are not allowed");
  }
};

const optimizeUploadedImage = async ({
  inputPath,
  outputPrefix,
  maxWidth,
  maxHeight,
}) => {
  const outputPath = path.join(uploadTempDirectory, `${outputPrefix}.webp`);

  try {
    await validateDecodedImage(inputPath);
    await sharp(inputPath, {
      failOn: "error",
      limitInputPixels: maxInputPixels,
      sequentialRead: true,
    })
      .rotate()
      .resize({
        width: maxWidth,
        height: maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toFile(outputPath);

    await removeFile(inputPath);
    return outputPath;
  } catch (error) {
    await removeFile(inputPath);
    await removeFile(outputPath);
    throw error;
  }
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

export const uploadAdminImage = async (req, res) => {
  let optimizedPath = null;
  try {
    if (!req.file) {
      sendError(res, 400, "Image file is required");
      return;
    }

    const fieldError = validateUploadTextFields(req.body);
    if (fieldError) {
      await removeFile(req.file.path);
      sendError(res, 413, fieldError);
      return;
    }

    const studentId = String(req.body?.studentId || "").trim();
    optimizedPath = await optimizeUploadedImage({
      inputPath: req.file.path,
      outputPrefix: path.parse(req.file.filename).name,
      maxWidth: 720,
      maxHeight: 720,
    });
    const filename = path.basename(optimizedPath);
    const optimizedStat = await fs.stat(optimizedPath);
    let updatedAspirants = 0;
    const aspirantId = String(req.body?.aspirantId || "").trim();
    const electionId = String(req.body?.electionId || "").trim();
    const uploadResult = await uploadFileToFirebaseStorage({
      filePath: optimizedPath,
      storagePath: buildAspirantImageStoragePath({
        schoolId: req.schoolId,
        electionId: electionId || "draft",
        aspirantId,
        studentId,
        filename,
      }),
      contentType: "image/webp",
      metadata: {
        type: "aspirant",
        schoolId: String(req.schoolId || ""),
        electionId,
        aspirantId,
        studentId,
      },
    });
    await removeFile(optimizedPath);
    optimizedPath = null;
    const url = uploadResult.url;

    if (aspirantId) {
      const updateResult = await Aspirant.updateOne(
        { _id: aspirantId, schoolId: req.schoolId },
        { $set: { imageUrl: url } }
      );
      updatedAspirants = updateResult.modifiedCount || 0;
    } else if (electionId && studentId) {
      const updateResult = await Aspirant.updateMany(
        { schoolId: req.schoolId, electionId, studentId },
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
      replaced: false,
      updatedAspirants,
      url,
      storagePath: uploadResult.path,
    });
  } catch (error) {
    await removeFile(req.file?.path);
    await removeFile(optimizedPath);
    const isInvalidImage = isInvalidImageError(error);
    sendError(
      res,
      isInvalidImage ? 400 : 500,
      isInvalidImage ? error.message : "Unable to upload image"
    );
  }
};

export const uploadElectionImage = async (req, res) => {
  let optimizedPath = null;
  try {
    if (!req.file) {
      sendError(res, 400, "Image file is required");
      return;
    }

    const fieldError = validateUploadTextFields(req.body);
    if (fieldError) {
      await removeFile(req.file.path);
      sendError(res, 413, fieldError);
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
    optimizedPath = await optimizeUploadedImage({
      inputPath: req.file.path,
      outputPrefix: filenamePrefix,
      maxWidth: 1600,
      maxHeight: 900,
    });
    const filename = path.basename(optimizedPath);
    const optimizedStat = await fs.stat(optimizedPath);
    const electionId = String(req.body?.electionId || "").trim();
    const uploadResult = await uploadFileToFirebaseStorage({
      filePath: optimizedPath,
      storagePath: buildElectionImageStoragePath({
        schoolId: req.schoolId,
        electionId: electionId || "draft",
        clientKey,
        filename,
      }),
      contentType: "image/webp",
      metadata: {
        type: "election",
        schoolId: String(req.schoolId || ""),
        electionId,
        clientKey,
      },
    });
    await removeFile(optimizedPath);
    optimizedPath = null;
    const url = uploadResult.url;
    let updatedElection = false;

    if (electionId) {
      const updateResult = await Election.updateOne(
        { _id: electionId, schoolId: req.schoolId },
        { $set: { imageUrl: url } }
      );
      updatedElection = (updateResult.modifiedCount || 0) > 0;
    }

    await notifySchoolAdmins({
      schoolId: req.schoolId,
      type: "election_image_uploaded",
      title: "Election image uploaded",
      message: "An election image was uploaded successfully.",
      priority: "low",
      data: {
        clientKey,
        electionId,
        imageUrl: url,
      },
    });

    res.status(201).json({
      message: "Election image uploaded successfully",
      clientKey,
      originalName: req.file.originalname,
      mimeType: "image/webp",
      size: optimizedStat.size,
      replaced: false,
      updatedElection,
      url,
      storagePath: uploadResult.path,
    });
  } catch (error) {
    await removeFile(req.file?.path);
    await removeFile(optimizedPath);
    const isInvalidImage = isInvalidImageError(error);
    sendError(
      res,
      isInvalidImage ? 400 : 500,
      isInvalidImage ? error.message : "Unable to upload election image"
    );
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

export const getUploadedImageFile = async (req, res) => {
  try {
    const filename = String(req.params?.filename || "").trim();
    const imagePath = await getUploadedImageFilePath(filename);

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

export const getUploadedElectionImageFile = async (req, res) => {
  try {
    const filename = String(req.params?.filename || "").trim();
    const imagePath = await getElectionImageFilePath(filename);

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
    const maxMb = Math.ceil(
      (Number(process.env.IMAGE_UPLOAD_MAX_BYTES) || 5 * 1024 * 1024) /
        (1024 * 1024)
    );
    sendError(res, 400, `Image must be ${maxMb}MB or smaller`);
    return;
  }

  if (
    ["LIMIT_FILE_COUNT", "LIMIT_FIELD_COUNT", "LIMIT_PART_COUNT", "LIMIT_FIELD_VALUE"].includes(
      error.code
    )
  ) {
    sendError(res, 400, "Image upload contains too many or oversized form fields");
    return;
  }

  sendError(res, 400, error.message || "Invalid image upload");
};
