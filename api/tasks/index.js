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
    // #region agent log
    fetch('http://127.0.0.1:7614/ingest/dc72bbfa-5e36-411f-bf0b-46fc5bec4a82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6943af'},body:JSON.stringify({sessionId:'6943af',runId:'pre-fix',hypothesisId:'H0',location:'api/tasks/index.js:entry',message:'Handler entry',data:{method:req.method,tableEnv:process.env.SEATABLE_TABLE_NAME||null,viewEnv:process.env.SEATABLE_VIEW_NAME||null,serverEnv:process.env.SEATABLE_SERVER||null,baseUuidPresent:Boolean(process.env.SEATABLE_BASE_UUID)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const accessMeta = await getAppAccessToken();
    const baseUrl = getRowsBaseUrl(accessMeta);
    const rowsUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}&view_name=${encodeURIComponent(VIEW_NAME)}`;
    const rowsCreateUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}`;
    const isV2 = baseUrl.includes("/api/v2/");
    // #region agent log
    fetch('http://127.0.0.1:7614/ingest/dc72bbfa-5e36-411f-bf0b-46fc5bec4a82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'51bbec'},body:JSON.stringify({sessionId:'51bbec',runId:'run-1',hypothesisId:'H5',location:'api/tasks/index.js:handler',message:'Computed rows URL',data:{method:req.method,baseUrl,rowsUrl,table:TABLE_NAME,view:VIEW_NAME},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // #region agent log
    fetch('http://127.0.0.1:7614/ingest/dc72bbfa-5e36-411f-bf0b-46fc5bec4a82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6943af'},body:JSON.stringify({sessionId:'6943af',runId:'pre-fix',hypothesisId:'H1',location:'api/tasks/index.js:computed',message:'Computed SeaTable URLs',data:{baseUrl,isV2,rowsUrl,rowsCreateUrl,table:TABLE_NAME,view:VIEW_NAME,accessMetaHasUuid:Boolean(accessMeta&&accessMeta.dtable_uuid),accessMetaServer:(accessMeta&&accessMeta.dtable_server)||null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (req.method === "GET") {
      const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
      const tasks = Array.isArray(rows) ? rows.map(mapRowToTask) : [];
      return res.status(200).json({ tasks });
    }

    if (req.method === "POST") {
      const task = req.body || {};
      const row = mapTaskToRow(task);
      // #region agent log
      fetch('http://127.0.0.1:7614/ingest/dc72bbfa-5e36-411f-bf0b-46fc5bec4a82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6943af'},body:JSON.stringify({sessionId:'6943af',runId:'pre-fix',hypothesisId:'H2',location:'api/tasks/index.js:post',message:'Prepared row payload (redacted)',data:{rowKeys:Object.keys(row||{}),idValue:row?.id,deadlineType:typeof row?.deadline,deadlineValue:row?.deadline?String(row.deadline).slice(0,32):row?.deadline},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      let created;
      try {
        created = await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
          method: "POST",
          body: JSON.stringify(isV2 ? { rows: [row] } : { row }),
        });
      } catch (firstError) {
        // #region agent log
        fetch('http://127.0.0.1:7614/ingest/dc72bbfa-5e36-411f-bf0b-46fc5bec4a82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6943af'},body:JSON.stringify({sessionId:'6943af',runId:'pre-fix',hypothesisId:'H3',location:'api/tasks/index.js:firstError',message:'First create attempt failed',data:{message:firstError?.message||String(firstError)},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7614/ingest/dc72bbfa-5e36-411f-bf0b-46fc5bec4a82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6943af'},body:JSON.stringify({sessionId:'6943af',runId:'pre-fix',hypothesisId:'H4',location:'api/tasks/index.js:catch',message:'Handler failed',data:{message:error?.message||String(error)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return res.status(500).json({ error: error.message || "Unexpected API error" });
  }
};
