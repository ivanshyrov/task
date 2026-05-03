// SeaTable API для пользователей
const {
  buildDeleteRequestBody,
  buildUpdateRequestBody,
  getAppAccessToken,
  getRowsBaseUrl,
  seatableRequest,
} = require("../_seatable");
const { ensureAuth } = require("../_auth");
const { applyCors, applySecurityHeaders } = require("../_security");

const TABLE_NAME = process.env.SEATABLE_USERS_TABLE || "Users";
const MAX_REQUEST_SIZE = 100 * 1024;

const VALID_USERNAME_RE = /^[a-zA-Z0-9_а-яА-ЯёЁ\-]{2,30}$/;
const VALID_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ["admin", "employee"];

function validateUsername(str) {
  return typeof str === "string" && VALID_USERNAME_RE.test(str);
}
function validateEmail(str) {
  return typeof str === "string" && (!str || VALID_EMAIL_RE.test(str));
}
function validateRole(str) {
  return typeof str === "string" && VALID_ROLES.includes(str);
}

module.exports = async (req, res) => {
  applySecurityHeaders(res);
  const corsOk = applyCors(req, res);
  if (!corsOk) return;
  const currentUser = ensureAuth(req, res, { roles: ["admin", "employee"] });
  if (!currentUser) return;

  const bodyStr = JSON.stringify(req.body || {});
  if (bodyStr.length > MAX_REQUEST_SIZE) {
    return res.status(400).json({ error: "Request too large" });
  }

  async function fetchUserByRowId(rowId) {
    if (!rowId) return null;
    try {
      const meta = await getAppAccessToken();
      const url = getRowsBaseUrl(meta);
      if (url.includes("/api/v2/")) {
        const r = await seatableRequest(meta.access_token, `${url}/sql/`, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT * FROM \`${TABLE_NAME}\` WHERE \`_id\` = ? LIMIT 1`,
            convert_keys: true,
            parameters: [rowId],
          }),
        });
        return r?.results?.[0] || null;
      }
      const rows = await seatableRequest(meta.access_token, `${url}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}`, { method: "GET" });
      const list = Array.isArray(rows) ? rows : rows?.rows || [];
      return list.find((i) => i?._id === rowId) || null;
    } catch (e) {
      return null;
    }
  }

  try {
    const meta = await getAppAccessToken();
    const baseUrl = getRowsBaseUrl(meta);
    const rowsUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}`;
    const rowsCreateUrl = `${baseUrl}/rows/`;
    const isV2 = baseUrl.includes("/api/v2/");

    // GET - получить всех пользователей
    if (req.method === "GET") {
      let users = [];
      if (isV2) {
        const r = await seatableRequest(meta.access_token, `${baseUrl}/sql/`, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT * FROM \`${TABLE_NAME}\` ORDER BY \`username\` ASC LIMIT 10000`,
            convert_keys: true,
          }),
        });
        users = (r?.results || []).map((row) => ({
          username: row.username,
          fullName: row.full_name,
          role: row.role || "employee",
          department: row.department || "",
          position: row.position || "",
          email: row.email || "",
          phone: row.phone || "",
          office: row.office || "",
          avatar: row.avatar || "",
          _id: row._id,
        }));
      } else {
        const rows = await seatableRequest(meta.access_token, rowsUrl, { method: "GET" });
        const list = Array.isArray(rows) ? rows : rows?.rows || [];
        users = list.map((row) => ({
          username: row.username,
          fullName: row.full_name,
          role: row.role || "employee",
          department: row.department || "",
          position: row.position || "",
          email: row.email || "",
          phone: row.phone || "",
          office: row.office || "",
          avatar: row.avatar || "",
          _id: row._id,
        }));
      }
      return res.status(200).json({ users });
    }

    // POST - создать пользователя
    if (req.method === "POST") {
      if (currentUser.role !== "admin") return res.status(403).json({ error: "Forbidden" });
      const { user } = req.body;
      const username = String(user?.username || "").trim();

      if (!username || !validateUsername(username)) {
        return res.status(400).json({ error: "Неверный логин (2-30 символов)" });
      }
      if (user?.email && !validateEmail(user.email)) {
        return res.status(400).json({ error: "Неверный email" });
      }

      const row = {
        username,
        full_name: user.fullName || "",
        role: user.role || "employee",
        department: user.department || "",
        position: user.position || "",
        email: user.email || "",
        phone: user.phone || "",
        office: user.office || "",
        password_hash: user.passwordHash || "",
      };

      await seatableRequest(meta.access_token, rowsCreateUrl, {
        method: "POST",
        body: JSON.stringify(isV2 ? { table_name: TABLE_NAME, rows: [row] } : { row }),
      });

      return res.status(201).json({ success: true });
    }

    // PUT - обновить пользователя
    if (req.method === "PUT") {
      if (currentUser.role !== "admin") return res.status(403).json({ error: "Forbidden" });
      const username = req.query?.username || req.body?.username;
      const user = req.body?.user || req.body;
      if (!username) return res.status(400).json({ error: "Требуется username" });

      let rowId = null;
      if (isV2) {
        const r = await seatableRequest(meta.access_token, `${baseUrl}/sql/`, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT \`_id\` FROM \`${TABLE_NAME}\` WHERE \`username\` = ? LIMIT 1`,
            convert_keys: true,
            parameters: [username],
          }),
        });
        rowId = r?.results?.[0]?._id;
      }

      if (!rowId) return res.status(404).json({ error: "Пользователь не найден" });

      const row = {
        username: user.username,
        full_name: user.fullName || "",
        role: user.role || "employee",
        department: user.department || "",
        position: user.position || "",
        email: user.email || "",
        phone: user.phone || "",
        office: user.office || "",
      };
      if (typeof user.passwordHash === "string" && user.passwordHash.length > 0) {
        row.password_hash = user.passwordHash;
      }
      if (typeof user.avatar === "string" && user.avatar.length > 0) {
        row.avatar = user.avatar;
      }

      await seatableRequest(meta.access_token, rowsCreateUrl, {
        method: "PUT",
        body: JSON.stringify(buildUpdateRequestBody({ isV2, tableName: TABLE_NAME, rowId, row })),
      });

      const refreshedUser = await fetchUserByRowId(rowId);
      if (!refreshedUser) {
        throw new Error("SeaTable update verification failed: user not found after update");
      }

      return res.status(200).json({ success: true });
    }

    // DELETE - удалить пользователя
    if (req.method === "DELETE") {
      if (currentUser.role !== "admin") return res.status(403).json({ error: "Forbidden" });
      const username = req.query?.username || req.body?.username;
      if (!username) return res.status(400).json({ error: "Требуется username" });

      let rowId = null;
      if (isV2) {
        const r = await seatableRequest(meta.access_token, `${baseUrl}/sql/`, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT \`_id\` FROM \`${TABLE_NAME}\` WHERE \`username\` = ? LIMIT 1`,
            convert_keys: true,
            parameters: [username],
          }),
        });
        rowId = r?.results?.[0]?._id;
      }

      if (!rowId) return res.status(404).json({ error: "Пользователь не найден" });

      await seatableRequest(meta.access_token, rowsCreateUrl, {
        method: "DELETE",
        body: JSON.stringify(buildDeleteRequestBody({ isV2, tableName: TABLE_NAME, rowId })),
      });

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Метод не поддерживается" });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[users] handler failed", { message });
    return res.status(500).json({ error: message });
  }
};