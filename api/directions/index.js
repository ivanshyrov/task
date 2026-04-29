// SeaTable API для справочника направлений
const {
  buildDeleteRequestBody,
  buildUpdateRequestBody,
  getAppAccessToken,
  getRowsBaseUrl,
  seatableRequest,
} = require("../_seatable");

const TABLE_NAME = process.env.SEATABLE_DIRECTIONS_TABLE || "Directions";

module.exports = async (req, res) => {
  const debug = {
    method: req.method,
    table: TABLE_NAME,
    serverEnv: process.env.SEATABLE_SERVER || null,
    baseUuidPresent: Boolean(process.env.SEATABLE_BASE_UUID),
  };

  try {
    const accessMeta = await getAppAccessToken();
    const baseUrl = getRowsBaseUrl(accessMeta);
    const rowsUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}`;
    const rowsCreateUrl = `${baseUrl}/rows/`;
    const isV2 = baseUrl.includes("/api/v2/");

    async function fetchRowList() {
      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT * FROM \`${TABLE_NAME}\` ORDER BY \`name\` ASC LIMIT 10000`,
            convert_keys: true,
          }),
        });
        return Array.isArray(result?.results) ? result.results : [];
      }

      const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
      const list = Array.isArray(rows) ? rows : rows?.rows || [];
      return list.map((r) => (r?.row && typeof r.row === "object" ? r.row : r));
    }

    async function findRowIdByName(name) {
      if (!name) return null;

      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT \`_id\` FROM \`${TABLE_NAME}\` WHERE \`name\` = ? LIMIT 1`,
            convert_keys: true,
            parameters: [name],
          }),
        });
        return Array.isArray(result?.results) && result.results.length ? result.results[0]?._id || null : null;
      }

      const list = await fetchRowList();
      const found = list.find((r) => (r?.name || "") === name);
      return found ? found._id || found.row?._id || null : null;
    }

    if (req.method === "GET") {
      const list = await fetchRowList();
      const directions = list
        .map((row) => ({
          name: row?.name || "",
        }))
        .filter((d) => d.name);
      return res.status(200).json({ directions });
    }

    if (req.method === "POST") {
      const { name } = req.body || {};
      const directionName = String(name || "").trim();
      if (!directionName) return res.status(400).json({ error: "Требуется name" });

      const existingId = await findRowIdByName(directionName);
      if (existingId) {
        return res.status(409).json({ error: "Такое направление уже существует" });
      }

      const row = { name: directionName };
      const body = isV2 ? { table_name: TABLE_NAME, rows: [row] } : { row };
      await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
        method: "POST",
        body: JSON.stringify(body),
      });

      return res.status(201).json({ success: true });
    }

    if (req.method === "PUT") {
      const oldName = String(req.body?.oldName || req.query?.oldName || "").trim();
      const name = String(req.body?.name || req.query?.name || "").trim();
      if (!oldName || !name) return res.status(400).json({ error: "Требуются oldName и name" });

      const rowId = await findRowIdByName(oldName);
      if (!rowId) return res.status(404).json({ error: "Направление не найдено" });

      // Переименование в уже существующее имя запрещаем
      const conflictId = await findRowIdByName(name);
      if (conflictId && conflictId !== rowId) {
        return res.status(409).json({ error: "Направление с таким именем уже существует" });
      }

      const row = { name };
      await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
        method: "PUT",
        body: JSON.stringify(
          buildUpdateRequestBody({
            isV2,
            tableName: TABLE_NAME,
            rowId,
            row,
          })
        ),
      });

      return res.status(200).json({ success: true });
    }

    if (req.method === "DELETE") {
      const name = String(req.body?.name || req.query?.name || "").trim();
      if (!name) return res.status(400).json({ error: "Требуется name" });

      const rowId = await findRowIdByName(name);
      if (!rowId) return res.status(404).json({ error: "Направление не найдено" });

      await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
        method: "DELETE",
        body: JSON.stringify(
          buildDeleteRequestBody({
            isV2,
            tableName: TABLE_NAME,
            rowId,
          })
        ),
      });

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Метод не поддерживается" });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[directions] handler failed", { message });
    return res.status(500).json({ error: message || "Unexpected API error", debug });
  }
};

