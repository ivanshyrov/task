const {
  getAppAccessToken,
  getRowsBaseUrl,
  seatableRequest,
} = require("./_seatable");

module.exports = async (req, res) => {
  if (typeof res?.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

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
      server: process.env.SEATABLE_SERVER || "https://cloud.seatable.io",
      at: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      service: "seatable",
      latencyMs: Date.now() - startedAt,
      error: error?.message || String(error),
      at: new Date().toISOString(),
    });
  }
};

