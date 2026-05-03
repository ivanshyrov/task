const { ensureAuth } = require("../_auth");
const { applyCors, applySecurityHeaders } = require("../_security");

module.exports = async (req, res) => {
  applySecurityHeaders(res);
  const corsOk = applyCors(req, res, "GET, OPTIONS");
  if (!corsOk) return;

  if (String(req.method || "").toUpperCase() !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = ensureAuth(req, res);
  if (!user) return;
  return res.status(200).json({ user });
};
