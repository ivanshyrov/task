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

    if (req.method === "GET") {
      const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
      const tasks = Array.isArray(rows) ? rows.map(mapRowToTask) : [];
      return res.status(200).json({ tasks });
    }

    if (req.method === "POST") {
      const task = req.body || {};
      const row = mapTaskToRow(task);
      const created = await seatableRequest(accessMeta.access_token, rowsUrl, {
        method: "POST",
        body: JSON.stringify({ row }),
      });
      return res.status(201).json({ task: mapRowToTask(created) });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unexpected API error" });
  }
};
