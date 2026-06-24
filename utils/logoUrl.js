import path from "path";
import fs from "fs";

const isRemoteUrl = (value = "") => /^https?:\/\//i.test(value);
const isLocalFilePath = (value = "") =>
  /^[a-zA-Z]:\\/.test(value) || value.startsWith("/") || value.startsWith("\\");
const getAssetVersion = (filename = "") => {
  const logoPath = path.join(process.cwd(), "public", "assets", "logos", filename);

  try {
    return fs.statSync(logoPath).mtimeMs.toFixed(0);
  } catch {
    return "";
  }
};

const buildLogoAssetUrl = (req, filename = "") => {
  const encodedFilename = encodeURIComponent(filename);
  const version = getAssetVersion(filename);
  const versionQuery = version ? `?v=${version}` : "";
  const protocol = req.protocol;
  const host = req.get("host");

  return `${protocol}://${host}/assets/logos/${encodedFilename}${versionQuery}`;
};

export const resolveLogoUrl = (req, rawLogoUrl = "") => {
  const value = String(rawLogoUrl || "").trim();
  if (!value) {
    return "";
  }

  if (isRemoteUrl(value)) {
    return value;
  }

  if (value.startsWith("/assets/")) {
    const version =
      value.startsWith("/assets/logos/")
        ? getAssetVersion(path.basename(value))
        : "";
    const versionQuery = version ? `?v=${version}` : "";
    return `${req.protocol}://${req.get("host")}${value}${versionQuery}`;
  }

  if (isLocalFilePath(value)) {
    return buildLogoAssetUrl(req, path.basename(value));
  }

  if (value.includes("assets/logos/")) {
    return buildLogoAssetUrl(req, path.basename(value));
  }

  if (!value.includes("/") && !value.includes("\\")) {
    return buildLogoAssetUrl(req, value);
  }

  return value;
};
