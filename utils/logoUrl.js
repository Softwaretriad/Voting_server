import path from "path";

const isRemoteUrl = (value = "") => /^https?:\/\//i.test(value);
const isLocalFilePath = (value = "") =>
  /^[a-zA-Z]:\\/.test(value) || value.startsWith("/") || value.startsWith("\\");

export const resolveLogoUrl = (req, rawLogoUrl = "") => {
  const value = String(rawLogoUrl || "").trim();
  if (!value) {
    return "";
  }

  if (isRemoteUrl(value)) {
    return value;
  }

  if (value.startsWith("/assets/")) {
    return `${req.protocol}://${req.get("host")}${value}`;
  }

  if (isLocalFilePath(value)) {
    const filename = encodeURIComponent(path.basename(value));
    return `${req.protocol}://${req.get("host")}/assets/logos/${filename}`;
  }

  return value;
};
