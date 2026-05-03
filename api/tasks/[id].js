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
const { ensureAuth } = require("../_auth");
const { applyCors, applySecurityHeaders } = require("../_security");
const fallbackNormalizeAttachments = async (_accessMeta, attachments) =>
  Array.isArray(attachments) ? attachments : [];

const TABLE_NAME = process.env.SEATABLE_TABLE_NAME || "Tasks";
const VIEW_NAME = process.env.SEATABLE_VIEW_NAME || "Default";

module.exports = async (req, res) => {
  applySecurityHeaders(res);
  const corsOk = applyCors(req, res);
  if (!corsOk) return;
  const currentUser = ensureAuth(req, res, { roles: ["admin", "employee"] });
  if (!currentUser) return;

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
      const task = mapRowToTask(row);
      if (currentUser.role !== "admin" && String(task.author || "") !== String(currentUser.fullName || "")) {
        return res.status(403).json({ error: "Forbidden", debug });
      }
      return res.status(200).json({ task });
    }

    if (method === "PUT") {
      debug.bodyHasRowId = Boolean(req.body?.row_id);
      const rowId = req.body?.row_id || (await resolveRowId());
      debug.resolvedRowId = rowId || null;
      if (!rowId) return res.status(404).json({ error: "Task not found (cannot resolve row_id)", debug });

      const existingRow = await fetchTaskByIdFull();
      if (!existingRow) return res.status(404).json({ error: "Task not found", debug });
      const existingTask = mapRowToTask(existingRow);
      if (
        currentUser.role !== "admin" &&
        String(existingTask.author || "") !== String(currentUser.fullName || "")
      ) {
        return res.status(403).json({ error: "Forbidden", debug });
      }

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
      return res.status(200).json({ task: refreshedTask });
    }

    if (method === "DELETE") {
      debug.bodyHasRowId = Boolean(req.body?.row_id);
      const existingRow = await fetchTaskByIdFull();
      if (!existingRow) return res.status(404).json({ error: "Task not found", debug });
      const existingTask = mapRowToTask(existingRow);
      if (
        currentUser.role !== "admin" &&
        String(existingTask.author || "") !== String(currentUser.fullName || "")
      ) {
        return res.status(403).json({ error: "Forbidden", debug });
      }
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