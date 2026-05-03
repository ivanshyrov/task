// SeaTable API для справочника направлений деятельности
const {
  buildDeleteRequestBody,
  buildUpdateRequestBody,
  getAppAccessToken,
  getRowsBaseUrl,
  seatableRequest,
} = require("../_seatable");

const TABLE_NAME = process.env.SEATABLE_ACTIVITY_TABLE || "ActivityDirections";
const MAX_REQUEST_SIZE = 100 * 1024;

// Rate limiting
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS_PER_MINUTE = 30;

function checkRateLimit(ip) {
    const now = Date.now();
    const requests = requestCounts.get(ip) || { count: 0, windowStart: now };
    if (now - requests.windowStart > RATE_LIMIT_WINDOW) {
        requests.count = 0;
        requests.windowStart = now;
    }
    requests.count++;
    requestCounts.set(ip, requests);
    return requests.count <= MAX_REQUESTS_PER_MINUTE;
}

module.exports = async (req, res) => {
  if (typeof res?.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  
  const clientIP = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIP)) {
    return res.status(429).json({ error: "Too many requests" });
  }
  
  const bodyStr = JSON.stringify(req.body || {});
  if (bodyStr.length > MAX_REQUEST_SIZE) {
    return res.status(400).json({ error: "Request too large" });
  }

  try {
    const accessMeta = await getAppAccessToken();
    const baseUrl = getRowsBaseUrl(accessMeta);
    const rowsUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}`;
    const rowsCreateUrl = `${baseUrl}/rows/`;
    const isV2 = baseUrl.includes("/api/v2/");

    // GET - получить все направления деятельности
    if (req.method === "GET") {
      let directions = [];
      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT * FROM \`${TABLE_NAME}\` ORDER BY \`name\` ASC LIMIT 10000`,
            convert_keys: true,
          }),
        });
        directions = Array.isArray(result?.results) ? result.results : [];
      } else {
        const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
        directions = Array.isArray(rows) ? rows : rows?.rows || [];
      }
      return res.status(200).json({ directions });
    }

    // POST - создать направление деятельности
    if (req.method === "POST") {
      const { name } = req.body;
      const cleanName = String(name || "").trim().slice(0, 255);
      if (!cleanName) {
        return res.status(400).json({ error: "Требуется название" });
      }
      
      let existing = null;
      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT \`_id\` FROM \`${TABLE_NAME}\` WHERE \`name\` = ? LIMIT 1`,
            convert_keys: true,
            parameters: [cleanName],
          }),
        });
        existing = Array.isArray(result?.results) && result.results.length ? result.results[0] : null;
      }
      
      if (existing) {
        return res.status(409).json({ error: "Направление уже существует" });
      }
      
      const row = { name: cleanName };
      await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
        method: "POST",
        body: JSON.stringify(isV2 ? { table_name: TABLE_NAME, rows: [row] } : { row }),
      });
      
      return res.status(201).json({ success: true });
    }

    // PUT - обновить направление деятельности
    if (req.method === "PUT") {
      const rowId = req.query?.row_id || req.body?.row_id;
      const { name } = req.body;
      if (!rowId) {
        return res.status(400).json({ error: "Требуется row_id" });
      }
      
      const cleanName = String(name || "").trim().slice(0, 255);
      if (!cleanName) {
        return res.status(400).json({ error: "Требуется название" });
      }
      
      const row = { name: cleanName };
      await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
        method: "PUT",
        body: JSON.stringify(buildUpdateRequestBody({
          isV2,
          tableName: TABLE_NAME,
          rowId,
          row,
        })),
      });
      
      return res.status(200).json({ success: true });
    }

    // DELETE - удалить направление деятельности
    if (req.method === "DELETE") {
      const rowId = req.query?.row_id || req.body?.row_id;
      if (!rowId) {
        return res.status(400).json({ error: "Требуется row_id" });
      }
      
      await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
        method: "DELETE",
        body: JSON.stringify(buildDeleteRequestBody({
          isV2,
          tableName: TABLE_NAME,
          rowId,
        })),
      });
      
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Метод не поддерживается" });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[activity] handler failed", { message });
    return res.status(500).json({ error: message });
  }
};