const {
  getAppAccessToken,
  getRowsBaseUrl,
  mapRowToTask,
  mapTaskToRow,
  seatableRequest,
} = require("../_seatable");

const TABLE_NAME = process.env.SEATABLE_TABLE_NAME || "Tasks";

module.exports = async (req, res) => {
  const debug = {
    method: req.method,
    id: req.query?.id,
    numericId: null,
    bodyHasRowId: false,
    resolvedRowId: null,
    seatableRowsShape: null,
    seatableRowsTopKeys: null,
    seatableListLen: null,
    matchFound: false,
    matchRowId: null,
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
    const rowsUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}`;
    const isV2 = baseUrl.includes("/api/v2/");

    async function resolveRowId() {
      // If frontend didn't send row_id, find it by our numeric "id" column.
      if (!Number.isFinite(numericId)) return null;
      const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
      debug.seatableRowsShape = Array.isArray(rows) ? "array" : typeof rows;
      const list =
        (Array.isArray(rows) ? rows : null) ||
        rows?.rows ||
        rows?.results ||
        rows?.data?.rows ||
        rows?.data?.results ||
        null;
      debug.seatableRowsTopKeys = rows && typeof rows === "object" && !Array.isArray(rows) ? Object.keys(rows).slice(0, 30) : null;
      debug.seatableListLen = Array.isArray(list) ? list.length : null;
      console.log("[taskById] resolveRowId fetched", {
        gotArray: Array.isArray(rows),
        topKeys: rows && typeof rows === "object" ? Object.keys(rows).slice(0, 15) : null,
        listLen: Array.isArray(list) ? list.length : null,
      });
      if (!Array.isArray(list)) return null;
      const found = list.find((r) => Number(r?.id) === numericId);
      debug.matchFound = Boolean(found);
      debug.matchRowId = found?._id || null;
      console.log("[taskById] resolveRowId match", {
        found: Boolean(found),
        foundId: found?._id || null,
      });
      return found?._id || null;
    }

    if (req.method === "PUT") {
      debug.bodyHasRowId = Boolean(req.body?.row_id);
      const rowId = req.body?.row_id || (await resolveRowId());
      debug.resolvedRowId = rowId || null;
      if (!rowId) return res.status(400).json({ error: "row_id is required for update", debug });

      const row = mapTaskToRow({ ...req.body, id: Number(id) });
      const updated = await seatableRequest(accessMeta.access_token, `${baseUrl}/rows/`, {
        method: "PUT",
        body: JSON.stringify(isV2 ? { table_name: TABLE_NAME, row_id: rowId, row } : { row_id: rowId, row }),
      });
      return res.status(200).json({ task: mapRowToTask(updated) });
    }

    if (req.method === "DELETE") {
      debug.bodyHasRowId = Boolean(req.body?.row_id);
      const rowId = req.body?.row_id || (await resolveRowId());
      debug.resolvedRowId = rowId || null;
      if (!rowId) return res.status(400).json({ error: "row_id is required for delete", debug });

      await seatableRequest(accessMeta.access_token, `${baseUrl}/rows/`, {
        method: "DELETE",
        body: JSON.stringify(isV2 ? { table_name: TABLE_NAME, row_id: rowId } : { row_id: rowId }),
      });
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
