const {
  getAppAccessToken,
  getRowsBaseUrl,
  mapRowToTask,
  mapTaskToRow,
  seatableRequest,
} = require("../_seatable");

const TABLE_NAME = process.env.SEATABLE_TABLE_NAME || "Tasks";

module.exports = async (req, res) => {
  try {
    const { id } = req.query;
    const accessMeta = await getAppAccessToken();
    const baseUrl = getRowsBaseUrl(accessMeta);
    const rowsUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}`;

    if (req.method === "PUT") {
      const rowId = req.body?.row_id;
      if (!rowId) return res.status(400).json({ error: "row_id is required for update" });

      const row = mapTaskToRow({ ...req.body, id: Number(id) });
      const updated = await seatableRequest(accessMeta.access_token, rowsUrl, {
        method: "PUT",
        body: JSON.stringify({ row_id: rowId, row }),
      });
      return res.status(200).json({ task: mapRowToTask(updated) });
    }

    if (req.method === "DELETE") {
      const rowId = req.body?.row_id;
      if (!rowId) return res.status(400).json({ error: "row_id is required for delete" });

      await seatableRequest(accessMeta.access_token, rowsUrl, {
        method: "DELETE",
        body: JSON.stringify({ row_id: rowId }),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unexpected API error" });
  }
};
