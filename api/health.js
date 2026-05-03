const {
  getAppAccessToken,
  getRowsBaseUrl,
  seatableRequest,
} = require("./_seatable");
const { ensureAuth } = require("./_auth");
const { applyCors, applySecurityHeaders } = require("./_security");

module.exports = async (req, res) => {
  applySecurityHeaders(res);
  const corsOk = applyCors(req, res, "GET, OPTIONS");
  if (!corsOk) return;
  const currentUser = ensureAuth(req, res, { roles: ["admin", "employee"] });
  if (!currentUser) return;

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const startedAt = Date.now();
  try {
    const accessMeta = await getAppAccessToken();
    const baseUrl = getRowsBaseUrl(accessMeta);
    const isV2 = baseUrl.includes("/api/v2/");

    // Lightweight ping: one tiny SQL query on cloud, one tiny rows fetch on self-hosted.
    if (isV2) {
      const tableName = process.env.SEATABLE_TABLE_NAME || "Tasks";
      await seatableRequest(accessMeta.access_token, `${baseUrl}/sql/`, {
        method: "POST",
        body: JSON.stringify({
          sql: `SELECT id FROM \`${tableName}\` LIMIT 1`,
          convert_keys: true,
        }),
        timeoutMs: 7000,
      });
    } else {
      const tableName = process.env.SEATABLE_TABLE_NAME || "Tasks";
      await seatableRequest(
        accessMeta.access_token,
        `${baseUrl}/rows/?table_name=${encodeURIComponent(tableName)}&limit=1`,
        { method: "GET", timeoutMs: 7000 }
      );
    }

    return res.status(200).json({
      ok: true,
      service: "seatable",
      latencyMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      service: "seatable",
      latencyMs: Date.now() - startedAt,
      error: "Service unavailable",
      at: new Date().toISOString(),
    });
  }
};

