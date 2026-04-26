const {
  getAppAccessToken,
  getRowsBaseUrl,
  mapRowToTask,
  mapTaskToRow,
  seatableRequest,
} = require("../_seatable");

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
    // #region agent log
    fetch('http://127.0.0.1:7614/ingest/dc72bbfa-5e36-411f-bf0b-46fc5bec4a82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'51bbec'},body:JSON.stringify({sessionId:'51bbec',runId:'run-1',hypothesisId:'H5',location:'api/tasks/index.js:handler',message:'Computed rows URL',data:{method:req.method,baseUrl,rowsUrl:rowsUrlBase,table:TABLE_NAME,view:VIEW_NAME},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
      const row = mapTaskToRow(task);
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

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[tasks] handler failed", { message });
    return res.status(500).json({ error: message || "Unexpected API error", debug });
  }
};
