import { OAuth2Client } from "google-auth-library";

const client = new OAuth2Client();

const getAllowedClientIds = () =>
  String(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || "")
    .split(",")
    .map((clientId) => clientId.trim())
    .filter(Boolean);

export const verifyGoogleIdToken = async (idToken) => {
  const audience = getAllowedClientIds();
  if (audience.length === 0) {
    const error = new Error("Google OAuth is not configured");
    error.statusCode = 503;
    throw error;
  }

  const ticket = await client.verifyIdToken({
    idToken,
    audience,
  });
  const payload = ticket.getPayload();

  if (!payload?.sub || !payload?.email || payload.email_verified !== true) {
    const error = new Error("Google account email must be verified");
    error.statusCode = 401;
    throw error;
  }

  return {
    sub: payload.sub,
    email: String(payload.email).toLowerCase().trim(),
    firstName: payload.given_name || "",
    lastName: payload.family_name || "",
    name: payload.name || "",
    picture: payload.picture || "",
  };
};
