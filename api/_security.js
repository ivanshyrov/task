const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function getAllowedOrigins() {
  const envOrigins = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...envOrigins]);
}

function applySecurityHeaders(res) {
  if (typeof res?.setHeader !== "function") return;
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

function applyCors(req, res, methods = "GET, POST, PUT, DELETE, OPTIONS") {
  if (typeof res?.setHeader !== "function") return true;

  const origin = String(req?.headers?.origin || "").trim();
  const allowedOrigins = getAllowedOrigins();
  const isAllowed = !origin || allowedOrigins.has(origin);

  if (origin && isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (String(req?.method || "").toUpperCase() === "OPTIONS") {
    if (!isAllowed) {
      res.status(403).json({ error: "Origin not allowed" });
      return false;
    }
    res.status(204).end();
    return false;
  }

  return isAllowed;
}

module.exports = {
  applyCors,
  applySecurityHeaders,
};
