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
  try {
    const accessMeta = await getAppAccessToken();
    const baseUrl = getRowsBaseUrl(accessMeta);
    const rowsUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}&view_name=${encodeURIComponent(VIEW_NAME)}`;
    const rowsCreateUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}`;
    const isV2 = baseUrl.includes("/api/v2/");
    // #region agent log
    fetch('http://127.0.0.1:7614/ingest/dc72bbfa-5e36-411f-bf0b-46fc5bec4a82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'51bbec'},body:JSON.stringify({sessionId:'51bbec',runId:'run-1',hypothesisId:'H5',location:'api/tasks/index.js:handler',message:'Computed rows URL',data:{method:req.method,baseUrl,rowsUrl,table:TABLE_NAME,view:VIEW_NAME},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (req.method === "GET") {
      const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
      const tasks = Array.isArray(rows) ? rows.map(mapRowToTask) : [];
      return res.status(200).json({ tasks });
    }

    if (req.method === "POST") {
      const task = req.body || {};
      const row = mapTaskToRow(task);
      let created;
      try {
        created = await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
          method: "POST",
          body: JSON.stringify(isV2 ? { rows: [row] } : { row }),
        });
      } catch (firstError) {
        // SeaTable Cloud can require table_name in request body on POST /rows.
        created = await seatableRequest(accessMeta.access_token, `${baseUrl}/rows/`, {
          method: "POST",
          body: JSON.stringify(isV2 ? { rows: [row] } : { table_name: TABLE_NAME, row }),
        });
      }
      return res.status(201).json({ task: mapRowToTask(created) });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unexpected API error" });
  }
};
