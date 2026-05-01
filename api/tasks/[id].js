const {
  buildDeleteRequestBody,
  buildUpdateRequestBody,
  getAppAccessToken,
  getRowsBaseUrl,
  mapRowToTask,
  mapTaskToRow,
  normalizeAttachmentsForSeaTable,
  seatableRequest,
} = require("../_seatable");
const fallbackNormalizeAttachments = async (_accessMeta, attachments) =>
  Array.isArray(attachments) ? attachments : [];

const TABLE_NAME = process.env.SEATABLE_TABLE_NAME || "Tasks";
const VIEW_NAME = process.env.SEATABLE_VIEW_NAME || "Default";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

module.exports = async (req, res) => {
  if (typeof res.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  }

  const method = String(req.method || "").toUpperCase();
  const debug = {
    method,
    id: req.query?.id,
    numericId: null,
    bodyHasRowId: false,
    resolvedRowId: null,
    sqlUsed: false,
    sqlRowFound: false,
    error: null,
  };
  try {
    const { id } = req.query;
    const numericId = Number(id);
    debug.numericId = numericId;
    console.log("[taskById] entry", {
      method: req.method,
      id,
      numericId,
      bodyKeys: req.body ? Object.keys(req.body) : null,
    });
    const accessMeta = await getAppAccessToken();
    const baseUrl = getRowsBaseUrl(accessMeta);
    const isV2 = baseUrl.includes("/api/v2/");

    async function sqlQueryOneById(selectClause = "_id, id") {
      if (!isV2) return null;
      if (!Number.isFinite(numericId)) return null;
      debug.sqlUsed = true;
      const sqlUrl = `${baseUrl}/sql/`;
      const payload = {
        sql: `SELECT ${selectClause} FROM \`${TABLE_NAME}\` WHERE \`id\` = ? LIMIT 1`,
        convert_keys: true,
        parameters: [numericId],
      };
      let result;
      try {
        result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } catch (e) {
        console.error("[taskById] sql failed", { message: e?.message || String(e) });
        throw e;
      }
      const rows = result?.results;
      const row = Array.isArray(rows) && rows.length ? rows[0] : null;
      debug.sqlRowFound = Boolean(row);
      console.log("[taskById] sql result", {
        hasResultsArray: Array.isArray(rows),
        resultsLen: Array.isArray(rows) ? rows.length : null,
        firstKeys: row && typeof row === "object" ? Object.keys(row).slice(0, 20) : null,
        firstId: row?.id ?? null,
        firstRowId: row?._id ?? null,
      });
      return row;
    }

    async function resolveRowId() {
      // If frontend didn't send row_id, find it by our numeric "id" column.
      const row = await sqlQueryOneById();
      return row?._id || null;
    }

    async function fetchTaskByIdFull() {
      if (isV2) {
        return sqlQueryOneById("*");
      }

      const rowsUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}&view_name=${encodeURIComponent(VIEW_NAME)}`;
      const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
      const list =
        (Array.isArray(rows) ? rows : null) ||
        rows?.rows ||
        rows?.results ||
        rows?.data?.rows ||
        rows?.data?.results ||
        [];
      return Array.isArray(list) ? list.find((item) => Number((item?.row || item)?.id) === numericId) || null : null;
    }

    if (method === "OPTIONS") {
      return res.status(204).end();
    }

    if (method === "GET") {
      if (!Number.isFinite(numericId)) return res.status(400).json({ error: "invalid id", debug });
      const row = await fetchTaskByIdFull();
      if (!row) return res.status(404).json({ error: "Task not found", debug });
      return res.status(200).json({ task: mapRowToTask(row) });
    }

    if (method === "PUT") {
      debug.bodyHasRowId = Boolean(req.body?.row_id);
      const rowId = req.body?.row_id || (await resolveRowId());
      debug.resolvedRowId = rowId || null;
      if (!rowId) return res.status(404).json({ error: "Task not found (cannot resolve row_id)", debug });

      const normalizedAttachments = await (
        typeof normalizeAttachmentsForSeaTable === "function"
          ? normalizeAttachmentsForSeaTable
          : fallbackNormalizeAttachments
      )(accessMeta, req.body?.attachments);
      if (Array.isArray(req.body?.attachments) && req.body.attachments.length > 0 && normalizedAttachments.length === 0) {
        return res.status(400).json({
          error: "Не удалось загрузить вложение в SeaTable. Проверьте права API токена на upload.",
          debug,
        });
      }
      const row = mapTaskToRow({ ...req.body, id: Number(id) });
      if (Array.isArray(normalizedAttachments)) {
        row.attachments = normalizedAttachments;
      }
      await seatableRequest(accessMeta.access_token, `${baseUrl}/rows/`, {
        method: "PUT",
        body: JSON.stringify(buildUpdateRequestBody({
          isV2,
          tableName: TABLE_NAME,
          rowId,
          row,
        })),
      });
      const refreshedRow = await fetchTaskByIdFull();
      if (!refreshedRow) {
        return res.status(500).json({ error: "SeaTable update verification failed: task not found after update", debug });
      }
      const refreshedTask = mapRowToTask(refreshedRow);
      const expectedTask = mapRowToTask({ ...row, _id: rowId });
      const sameTask =
        String(refreshedTask.title || "") === String(expectedTask.title || "") &&
        String(refreshedTask.description || "") === String(expectedTask.description || "") &&
        String(refreshedTask.author || "") === String(expectedTask.author || "") &&
        String(refreshedTask.assignee || "") === String(expectedTask.assignee || "") &&
        String(refreshedTask.department || "") === String(expectedTask.department || "") &&
        String(refreshedTask.priority || "") === String(expectedTask.priority || "") &&
        String(refreshedTask.status || "") === String(expectedTask.status || "") &&
        String(refreshedTask.type || "") === String(expectedTask.type || "") &&
        String(refreshedTask.office || "") === String(expectedTask.office || "") &&
        String(refreshedTask.phone || "") === String(expectedTask.phone || "") &&
        String(refreshedTask.report || "") === String(expectedTask.report || "") &&
        String(refreshedTask.rejectedReason || "") === String(expectedTask.rejectedReason || "") &&
        String(refreshedTask.databaseId || "") === String(expectedTask.databaseId || "") &&
        Number(refreshedTask.slaDays || 0) === Number(expectedTask.slaDays || 0) &&
        String(refreshedTask.deadline || "").slice(0, 10) === String(expectedTask.deadline || "").slice(0, 10) &&
        String(refreshedTask.createdAt || "").slice(0, 10) === String(expectedTask.createdAt || "").slice(0, 10);
      if (!sameTask) {
        return res.status(500).json({ error: "SeaTable update verification failed: changes were not applied", debug });
      }
      return res.status(200).json({ task: refreshedTask });
    }

    if (method === "DELETE") {
      debug.bodyHasRowId = Boolean(req.body?.row_id);
      const rowId = req.body?.row_id || (await resolveRowId());
      debug.resolvedRowId = rowId || null;
      if (!rowId) return res.status(404).json({ error: "Task not found (cannot resolve row_id)", debug });

      const deleted = await seatableRequest(accessMeta.access_token, `${baseUrl}/rows/`, {
        method: "DELETE",
        body: JSON.stringify(buildDeleteRequestBody({
          isV2,
          tableName: TABLE_NAME,
          rowId,
        })),
      });
      // SeaTable v2 returns { deleted_rows: number }
      if (isV2 && deleted && typeof deleted.deleted_rows === "number" && deleted.deleted_rows < 1) {
        return res.status(404).json({ error: "Row not deleted in SeaTable", debug });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    const message = error?.message || String(error);
    debug.error = message.slice(0, 2000);
    console.error("[taskById] failed", { message });
    return res.status(500).json({ error: message || "Unexpected API error", debug });
  }
};
