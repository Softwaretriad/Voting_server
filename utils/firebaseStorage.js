import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

const normalizePrivateKey = (privateKey = "") =>
  String(privateKey || "")
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n");

const normalizeBucketName = (bucket = "") =>
  String(bucket || "")
    .trim()
    .replace(/^gs:\/\//, "")
    .replace(/^"|"$/g, "");

const getFirebaseConfig = () => {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim().replace(/^"|"$/g, "");
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  const storageBucket = normalizeBucketName(process.env.FIREBASE_STORAGE_BUCKET);

  return {
    projectId,
    clientEmail,
    privateKey,
    storageBucket,
  };
};

export const isFirebaseStorageConfigured = () => {
  const { projectId, clientEmail, privateKey, storageBucket } = getFirebaseConfig();
  return Boolean(projectId && clientEmail && privateKey && storageBucket);
};

export const getFirebaseApp = () => {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const { projectId, clientEmail, privateKey, storageBucket } = getFirebaseConfig();
  if (!projectId || !clientEmail || !privateKey || !storageBucket) {
    throw new Error(
      "Firebase Storage is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, and FIREBASE_STORAGE_BUCKET."
    );
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    storageBucket,
  });
};

export const getFirebaseStorageBucket = () => {
  const app = getFirebaseApp();
  return getStorage(app).bucket();
};

const encodeStoragePath = (storagePath) =>
  encodeURIComponent(storagePath).replace(/\*/g, "%2A");

export const buildFirebaseDownloadUrl = ({ bucketName, storagePath, token }) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeStoragePath(
    storagePath
  )}?alt=media&token=${encodeURIComponent(token)}`;

export const sanitizeStorageSegment = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

export const buildStoragePath = (...segments) =>
  segments
    .flat()
    .map(sanitizeStorageSegment)
    .filter(Boolean)
    .join("/");

export const buildElectionImageStoragePath = ({
  schoolId,
  electionId = "draft",
  clientKey = "election",
  filename = "image.webp",
}) =>
  buildStoragePath(
    "schools",
    schoolId,
    "elections",
    electionId,
    "images",
    `${sanitizeStorageSegment(clientKey)}-${Date.now()}-${sanitizeStorageSegment(filename)}`
  );

export const buildAspirantImageStoragePath = ({
  schoolId,
  electionId = "draft",
  aspirantId = null,
  studentId = null,
  filename = "image.webp",
}) =>
  buildStoragePath(
    "schools",
    schoolId,
    "elections",
    electionId,
    "aspirants",
    aspirantId || studentId || "aspirant",
    sanitizeStorageSegment(filename)
  );

export const uploadBufferToFirebaseStorage = async ({
  buffer,
  storagePath,
  contentType = "application/octet-stream",
  cacheControl = "public, max-age=31536000, immutable",
  metadata = {},
}) => {
  if (!buffer) {
    throw new Error("buffer is required");
  }

  if (!storagePath) {
    throw new Error("storagePath is required");
  }

  const bucket = getFirebaseStorageBucket();
  const token = crypto.randomUUID();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl,
      metadata: {
        ...metadata,
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  return {
    bucket: bucket.name,
    path: storagePath,
    token,
    url: buildFirebaseDownloadUrl({
      bucketName: bucket.name,
      storagePath,
      token,
    }),
  };
};

export const uploadPrivateBufferToFirebaseStorage = async ({
  buffer,
  storagePath,
  contentType = "application/octet-stream",
  metadata = {},
}) => {
  if (!buffer || !storagePath) {
    throw new Error("buffer and storagePath are required");
  }

  const bucket = getFirebaseStorageBucket();
  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType,
      cacheControl: "private, no-store",
      metadata,
    },
  });

  return { bucket: bucket.name, path: storagePath };
};

export const downloadPrivateFirebaseStorageBuffer = async (storagePath) => {
  if (!storagePath) {
    throw new Error("storagePath is required");
  }

  const [buffer] = await getFirebaseStorageBucket().file(storagePath).download();
  return buffer;
};

export const uploadFileToFirebaseStorage = async ({
  filePath,
  storagePath,
  contentType,
  cacheControl,
  metadata,
}) => {
  if (!filePath) {
    throw new Error("filePath is required");
  }

  const buffer = await fs.readFile(filePath);
  return uploadBufferToFirebaseStorage({
    buffer,
    storagePath,
    contentType,
    cacheControl,
    metadata: {
      originalFilename: path.basename(filePath),
      ...(metadata || {}),
    },
  });
};

export const deleteFirebaseStorageFile = async (storagePath) => {
  if (!storagePath) {
    return false;
  }

  const bucket = getFirebaseStorageBucket();
  await bucket.file(storagePath).delete({ ignoreNotFound: true });
  return true;
};
