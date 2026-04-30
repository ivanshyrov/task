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

module.exports = async (req, res) => {
  const debug = {
    method: req.method,
    table: TABLE_NAME,
    view: VIEW_NAME,
    serverEnv: process.env.SEATABLE_SERVER || null,
    baseUuidPresent: Boolean(process.env.SEATABLE_BASE_UUID),
    baseUrl: null,
    rowsUrl: null,
    rowsCreateUrl: null,
    isV2: null,
    accessMetaHasUuid: null,
    accessMetaServer: null,
    seatableError: null,
  };
  try {
    console.log("[tasks] entry", {
      method: req.method,
      tableEnv: process.env.SEATABLE_TABLE_NAME || null,
      viewEnv: process.env.SEATABLE_VIEW_NAME || null,
      serverEnv: process.env.SEATABLE_SERVER || null,
      baseUuidPresent: Boolean(process.env.SEATABLE_BASE_UUID),
    });
    const accessMeta = await getAppAccessToken();
    const baseUrl = getRowsBaseUrl(accessMeta);
    const rowsUrlBase = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}&view_name=${encodeURIComponent(VIEW_NAME)}`;
    const rowsCreateUrl = `${baseUrl}/rows/`;
    const isV2 = baseUrl.includes("/api/v2/");
    debug.baseUrl = baseUrl;
    debug.rowsUrl = rowsUrlBase;
    debug.rowsCreateUrl = rowsCreateUrl;
    debug.isV2 = isV2;
    debug.accessMetaHasUuid = Boolean(accessMeta && accessMeta.dtable_uuid);
    debug.accessMetaServer = (accessMeta && accessMeta.dtable_server) || null;
    console.log("[tasks] computed", {
      isV2,
      baseUrl,
      rowsUrl: rowsUrlBase,
      rowsCreateUrl,
      table: TABLE_NAME,
      view: VIEW_NAME,
      accessMetaHasUuid: Boolean(accessMeta && accessMeta.dtable_uuid),
      accessMetaServer: (accessMeta && accessMeta.dtable_server) || null,
    });

    async function fetchTaskById(taskId) {
      if (!Number.isFinite(Number(taskId))) return null;

      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT * FROM \`${TABLE_NAME}\` WHERE \`id\` = ? LIMIT 1`,
            convert_keys: true,
            parameters: [Number(taskId)],
          }),
        });
        return Array.isArray(result?.results) && result.results.length ? result.results[0] : null;
      }

      const rows = await seatableRequest(accessMeta.access_token, rowsUrlBase, { method: "GET" });
      const list =
        (Array.isArray(rows) ? rows : null) ||
        rows?.rows ||
        rows?.results ||
        rows?.data?.rows ||
        rows?.data?.results ||
        [];
      return Array.isArray(list) ? list.find((item) => Number((item?.row || item)?.id) === Number(taskId)) || null : null;
    }

    function normalizeDate(value) {
      return String(value || "").slice(0, 10);
    }

    function verifyTaskUpdate(expectedTask, actualTask) {
      return (
        String(actualTask.title || "") === String(expectedTask.title || "") &&
        String(actualTask.description || "") === String(expectedTask.description || "") &&
        String(actualTask.author || "") === String(expectedTask.author || "") &&
        String(actualTask.assignee || "") === String(expectedTask.assignee || "") &&
        String(actualTask.department || "") === String(expectedTask.department || "") &&
        String(actualTask.priority || "") === String(expectedTask.priority || "") &&
        String(actualTask.status || "") === String(expectedTask.status || "") &&
        String(actualTask.type || "") === String(expectedTask.type || "") &&
        String(actualTask.office || "") === String(expectedTask.office || "") &&
        String(actualTask.phone || "") === String(expectedTask.phone || "") &&
        String(actualTask.report || "") === String(expectedTask.report || "") &&
        String(actualTask.rejectedReason || "") === String(expectedTask.rejectedReason || "") &&
        String(actualTask.databaseId || "") === String(expectedTask.databaseId || "") &&
        Number(actualTask.slaDays || 0) === Number(expectedTask.slaDays || 0) &&
        normalizeDate(actualTask.deadline) === normalizeDate(expectedTask.deadline) &&
        normalizeDate(actualTask.createdAt) === normalizeDate(expectedTask.createdAt)
      );
    }

    if (req.method === "GET") {
      let tasks = [];
      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT * FROM \`${TABLE_NAME}\` ORDER BY \`id\` ASC LIMIT 10000`,
            convert_keys: true,
          }),
        });
        const list = Array.isArray(result?.results) ? result.results : [];
        tasks = list.map(mapRowToTask);
      } else {
        const limit = 1000;
        let start = 0;
        const all = [];
        while (true) {
          const pageUrl = `${rowsUrlBase}&start=${start}&limit=${limit}`;
          const rows = await seatableRequest(accessMeta.access_token, pageUrl, { method: "GET" });
          const list =
            (Array.isArray(rows) ? rows : null) ||
            rows?.rows ||
            rows?.results ||
            rows?.data?.rows ||
            rows?.data?.results ||
            null;
          if (!Array.isArray(list) || list.length === 0) break;
          all.push(...list);
          if (list.length < limit) break;
          start += limit;
        }
        tasks = all.map(mapRowToTask);
      }
      return res.status(200).json({ tasks });
    }

    if (req.method === "POST") {
      const task = req.body || {};
      const normalizedAttachments = await (
        typeof normalizeAttachmentsForSeaTable === "function"
          ? normalizeAttachmentsForSeaTable
          : fallbackNormalizeAttachments
      )(accessMeta, task.attachments);
      const row = mapTaskToRow(task);
      if (Array.isArray(normalizedAttachments)) {
        row.attachments = normalizedAttachments;
      }
      console.log("[tasks] prepared-row", {
        rowKeys: Object.keys(row || {}),
        idValue: row?.id,
        deadlineType: typeof row?.deadline,
        deadlineValue: row?.deadline ? String(row.deadline).slice(0, 32) : row?.deadline,
      });
      let created;
      try {
        if (isV2) {
          // Generate a stable monotonically increasing id on the server (source of truth is SeaTable).
          const sqlUrl = `${baseUrl}/sql/`;
          const maxRes = await seatableRequest(accessMeta.access_token, sqlUrl, {
            method: "POST",
            body: JSON.stringify({
              sql: `SELECT id FROM \`${TABLE_NAME}\` ORDER BY \`id\` DESC LIMIT 1`,
              convert_keys: true,
            }),
          });
          const maxId = Number(maxRes?.results?.[0]?.id ?? 0) || 0;
          const assignedId = maxId + 1;
          row.id = assignedId;
          console.log("[tasks] assigned id", { maxId, assignedId });
        }
        const body = isV2 ? { table_name: TABLE_NAME, rows: [row] } : { row };
        created = await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (isV2) {
          // SeaTable responses can omit the row data; re-fetch by assigned id to return canonical payload.
          const assignedId = row.id;
          const sqlUrl = `${baseUrl}/sql/`;
          const fetched = await seatableRequest(accessMeta.access_token, sqlUrl, {
            method: "POST",
            body: JSON.stringify({
              sql: `SELECT * FROM \`${TABLE_NAME}\` WHERE \`id\` = ? LIMIT 1`,
              convert_keys: true,
              parameters: [assignedId],
            }),
          });
          const canonical = Array.isArray(fetched?.results) && fetched.results.length ? fetched.results[0] : null;
          if (canonical) created = canonical;
        }
      } catch (firstError) {
        const msg = firstError?.message || String(firstError);
        debug.seatableError = msg.slice(0, 2000);
        console.error("[tasks] create failed", { message: msg });
        throw firstError;
      }
      return res.status(201).json({ task: mapRowToTask(created) });
    }

    // PUT - обновить задачу
    if (req.method === "PUT") {
      const task = req.body || {};
      const rowId = task.row_id;
      const taskId = task.id;
      
      if (!rowId) {
        return res.status(400).json({ error: "Требуется row_id" });
      }

      const normalizedAttachments = await (
        typeof normalizeAttachmentsForSeaTable === "function"
          ? normalizeAttachmentsForSeaTable
          : fallbackNormalizeAttachments
      )(accessMeta, task.attachments);
      const row = mapTaskToRow(task);
      if (Array.isArray(normalizedAttachments)) {
        row.attachments = normalizedAttachments;
      }
      console.log("[tasks] updating", { rowId, taskId, row });

      const body = buildUpdateRequestBody({
        isV2,
        tableName: TABLE_NAME,
        rowId,
        row,
      });

      try {
        const result = await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        console.log("[tasks] update result", { result });

        const refreshedRow = await fetchTaskById(taskId);
        if (!refreshedRow) {
          throw new Error("SeaTable update verification failed: task not found after update");
        }
        const refreshedTask = mapRowToTask(refreshedRow);
        const expectedTask = mapRowToTask({ ...row, _id: rowId });
        if (!verifyTaskUpdate(expectedTask, refreshedTask)) {
          throw new Error("SeaTable update verification failed: changes were not applied");
        }
        return res.status(200).json({ success: true, task: refreshedTask });
      } catch (updateError) {
        console.error("[tasks] update failed", { message: updateError?.message });
        throw updateError;
      }
    }

    // DELETE - удалить задачу
    if (req.method === "DELETE") {
      const row_id = req.body?.row_id;
      const id = req.body?.id;
      
      if (!row_id) {
        return res.status(400).json({ error: "Требуется row_id" });
      }

      console.log("[tasks] deleting", { row_id, id });

      const body = buildDeleteRequestBody({
        isV2,
        tableName: TABLE_NAME,
        rowId: row_id,
      });

      await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
        method: "DELETE",
        body: JSON.stringify(body),
      });

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[tasks] handler failed", { message });
    return res.status(500).json({ error: message || "Unexpected API error", debug });
  }
};
