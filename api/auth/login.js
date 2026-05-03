const { authenticateByPassword, createSession, setSessionCookie } = require("../_auth");
const { applyCors, applySecurityHeaders } = require("../_security");

module.exports = async (req, res) => {
  applySecurityHeaders(res);
  const corsOk = applyCors(req, res, "POST, OPTIONS");
  if (!corsOk) return;

  if (String(req.method || "").toUpperCase() !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  try {
    const user = await authenticateByPassword(username, password);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const { token } = createSession(user);
    setSessionCookie(res, token);
    return res.status(200).json({ user });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Login failed" });
  }
};
