export const securityHeaders = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-XSS-Protection", "0");
  if (req.secure) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
  next();
};

export const enforceHttps = (req, res, next) => {
  if (req.method === "OPTIONS") {
    return next();
  }

  const shouldEnforce =
    process.env.NODE_ENV === "production" &&
    process.env.ENFORCE_HTTPS === "true";

  if (!shouldEnforce || req.secure) {
    return next();
  }

  return res.status(426).json({ error: "HTTPS is required" });
};

export const corsMiddleware = (req, res, next) => {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  const requestedHeaders = String(
    req.headers["access-control-request-headers"] || ""
  ).trim();
  const allowedHeaders =
    requestedHeaders ||
    "Content-Type, Accept, Authorization, X-Requested-With, X-CSRF-Token";
  const allowedMethods = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

  if (!origin) {
    if (req.method === "OPTIONS") {
      res.setHeader("Allow", allowedMethods);
      res.setHeader("Access-Control-Allow-Methods", allowedMethods);
      res.setHeader("Access-Control-Allow-Headers", allowedHeaders);
      return res.status(204).end();
    }
    return next();
  }

  const allowAll = process.env.NODE_ENV !== "production" || allowedOrigins.includes("*");
  if (allowAll || allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", allowedHeaders);
    res.setHeader("Access-Control-Allow-Methods", allowedMethods);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Max-Age", "600");
    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  return next();
};
