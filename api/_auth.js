const crypto = require("node:crypto");
const { getAppAccessToken, getRowsBaseUrl, seatableRequest } = require("./_seatable");

const SESSION_COOKIE_NAME = "tp_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessionStore = new Map();

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function parseCookies(req) {
  const source = String(req?.headers?.cookie || "");
  if (!source) return {};
  return source.split(";").reduce((acc, part) => {
    const [rawName, ...rest] = part.split("=");
    const name = String(rawName || "").trim();
    if (!name) return acc;
    acc[name] = decodeURIComponent(rest.join("=").trim());
    return acc;
  }, {});
}

function getSessionSecret() {
  return String(process.env.SESSION_SECRET || "dev-only-change-session-secret");
}

function signSessionToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function verifySessionToken(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = crypto
    .createHmac("sha256", getSessionSecret())
    .update(body)
    .digest("base64url");
  if (signature !== expected) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function setSessionCookie(res, token, maxAgeMs = SESSION_TTL_MS) {
  if (typeof res?.setHeader !== "function") return;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
    maxAgeMs / 1000
  )}${secure}`;
  res.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(res) {
  if (typeof res?.setHeader !== "function") return;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

function createSession(user) {
  const sessionId = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessionStore.set(sessionId, { user, expiresAt });
  const token = signSessionToken({ sessionId, exp: expiresAt });
  return { token, sessionId, expiresAt };
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  const payload = verifySessionToken(token);
  if (!payload?.sessionId || !payload?.exp) return null;
  if (Date.now() > Number(payload.exp)) {
    sessionStore.delete(payload.sessionId);
    return null;
  }
  const session = sessionStore.get(payload.sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessionStore.delete(payload.sessionId);
    return null;
  }
  return { ...session, sessionId: payload.sessionId };
}

function destroySession(req) {
  const cookies = parseCookies(req);
  const payload = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
  if (payload?.sessionId) sessionStore.delete(payload.sessionId);
}

async function findUserByUsername(username) {
  const cleanUsername = String(username || "").trim();
  if (!cleanUsername) return null;
  const meta = await getAppAccessToken();
  const baseUrl = getRowsBaseUrl(meta);
  const tableName = process.env.SEATABLE_USERS_TABLE || "Users";
  const sqlUrl = `${baseUrl}/sql/`;
  const result = await seatableRequest(meta.access_token, sqlUrl, {
    method: "POST",
    body: JSON.stringify({
      sql: `SELECT * FROM \`${tableName}\` WHERE \`username\` = ? LIMIT 1`,
      convert_keys: true,
      parameters: [cleanUsername],
    }),
  });
  return Array.isArray(result?.results) && result.results.length ? result.results[0] : null;
}

async function authenticateByPassword(username, password) {
  const userRow = await findUserByUsername(username);
  if (!userRow) return null;
  const actualHash = String(userRow.password_hash || "");
  const expectedHash = sha256(password);
  if (!actualHash || actualHash !== expectedHash) return null;
  return {
    username: userRow.username,
    fullName: userRow.full_name || "",
    role: userRow.role || "employee",
    department: userRow.department || "",
    position: userRow.position || "",
    email: userRow.email || "",
    phone: userRow.phone || "",
    office: userRow.office || "",
    avatar: userRow.avatar || "",
  };
}

function ensureAuth(req, res, options = {}) {
  const roleSet = new Set(
    Array.isArray(options.roles) ? options.roles.map((item) => String(item || "").trim()) : []
  );

  if (process.env.NODE_ENV === "test") {
    return {
      username: req?.headers?.["x-test-auth-user"] || "test-admin",
      role: req?.headers?.["x-test-auth-role"] || "admin",
      fullName: "Test User",
    };
  }

  const session = getSession(req);
  if (!session?.user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (roleSet.size && !roleSet.has(String(session.user.role || ""))) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return session.user;
}

module.exports = {
  authenticateByPassword,
  clearSessionCookie,
  createSession,
  destroySession,
  ensureAuth,
  setSessionCookie,
};
