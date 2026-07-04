import crypto from "crypto";
import sharp from "sharp";
import {
  buildStoragePath,
  deleteFirebaseStorageFile,
  downloadPrivateFirebaseStorageBuffer,
  uploadPrivateBufferToFirebaseStorage,
} from "./firebaseStorage.js";

const ALGORITHM = "aes-256-gcm";
const allowedFormats = new Set(["jpeg", "png", "webp"]);
const maxPixels =
  Number(process.env.SCHOOL_DOCUMENT_MAX_PIXELS) || 50_000_000;
const maxDimension =
  Number(process.env.SCHOOL_DOCUMENT_MAX_DIMENSION) || 15_000;

const getEncryptionKey = () => {
  const encodedKey = String(
    process.env.SCHOOL_DOCUMENT_ENCRYPTION_KEY || ""
  ).trim();
  const key = Buffer.from(encodedKey, "base64");
  if (!encodedKey || key.length !== 32) {
    throw new Error(
      "SCHOOL_DOCUMENT_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
    );
  }
  return key;
};

const getAdditionalData = ({ schoolId, documentId }) =>
  Buffer.from(`${schoolId}:${documentId}`, "utf8");

const validateOfficialImage = async (buffer) => {
  const metadata = await sharp(buffer, {
    failOn: "error",
    limitInputPixels: maxPixels,
    sequentialRead: true,
  }).metadata();

  if (!allowedFormats.has(metadata.format)) {
    throw new Error("Decoded official document format is not allowed");
  }
  if (!metadata.width || !metadata.height) {
    throw new Error("Official document dimensions could not be read");
  }
  if (metadata.width > maxDimension || metadata.height > maxDimension) {
    throw new Error(
      `Official document dimensions must not exceed ${maxDimension}px`
    );
  }
  if ((metadata.pages || 1) !== 1) {
    throw new Error("Animated or multi-page official documents are not allowed");
  }
};

export const encryptAndUploadOfficialSchoolDocument = async ({
  schoolId,
  documentId,
  file,
}) => {
  await validateOfficialImage(file.buffer);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  cipher.setAAD(getAdditionalData({ schoolId, documentId }));
  const encryptedBuffer = Buffer.concat([
    cipher.update(file.buffer),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const storagePath = buildStoragePath(
    "private",
    "schools",
    schoolId,
    "official-documents",
    `${documentId}.enc`
  );

  await uploadPrivateBufferToFirebaseStorage({
    buffer: encryptedBuffer,
    storagePath,
    metadata: {
      type: "official-school-document",
      schoolId: String(schoolId),
      documentId: String(documentId),
      algorithm: ALGORITHM,
    },
  });

  return {
    storagePath,
    originalName: String(file.originalname || "official-document").slice(0, 255),
    mimeType: file.mimetype,
    size: file.size,
    sha256,
    encryption: {
      algorithm: ALGORITHM,
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    },
  };
};

export const downloadAndDecryptOfficialSchoolDocument = async ({
  schoolId,
  document,
}) => {
  if (document.encryption?.algorithm !== ALGORITHM) {
    throw new Error("Unsupported official document encryption algorithm");
  }

  const encryptedBuffer = await downloadPrivateFirebaseStorageBuffer(
    document.storagePath
  );
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(document.encryption.iv, "base64")
  );
  decipher.setAAD(
    getAdditionalData({
      schoolId,
      documentId: document._id.toString(),
    })
  );
  decipher.setAuthTag(Buffer.from(document.encryption.authTag, "base64"));
  const decryptedBuffer = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final(),
  ]);
  const sha256 = crypto
    .createHash("sha256")
    .update(decryptedBuffer)
    .digest("hex");

  if (sha256 !== document.sha256) {
    throw new Error("Official document integrity verification failed");
  }

  return decryptedBuffer;
};

export const deleteOfficialSchoolDocument = (storagePath) =>
  deleteFirebaseStorageFile(storagePath);

