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

    async function sqlQueryOneById() {
      if (!isV2) return null;
      if (!Number.isFinite(numericId)) return null;
      debug.sqlUsed = true;
      const sqlUrl = `${baseUrl}/sql/`;
      const payload = {
        sql: `SELECT _id, id FROM \`${TABLE_NAME}\` WHERE \`id\` = ? LIMIT 1`,
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

    if (req.method === "GET") {
      if (!Number.isFinite(numericId)) return res.status(400).json({ error: "invalid id", debug });
      const row = await sqlQueryOneById();
      if (!row) return res.status(404).json({ error: "Task not found", debug });
      return res.status(200).json({ task: mapRowToTask(row) });
    }

    if (req.method === "PUT") {
      debug.bodyHasRowId = Boolean(req.body?.row_id);
      const rowId = req.body?.row_id || (await resolveRowId());
      debug.resolvedRowId = rowId || null;
      if (!rowId) return res.status(404).json({ error: "Task not found (cannot resolve row_id)", debug });

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
      if (!rowId) return res.status(404).json({ error: "Task not found (cannot resolve row_id)", debug });

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
