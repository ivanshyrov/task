// SeaTable API для пользователей
const {
  buildDeleteRequestBody,
  buildUpdateRequestBody,
  getAppAccessToken,
  getRowsBaseUrl,
  seatableRequest,
} = require("../_seatable");

const TABLE_NAME = process.env.SEATABLE_USERS_TABLE || "Users";
const MAX_REQUEST_SIZE = 100 * 1024;

// Validation helpers
function sanitizeString(str, maxLength = 255) {
    if (typeof str !== 'string') return '';
    return str.slice(0, maxLength).replace(/[<>'"&]/g, '');
}

function validateUsername(username) {
    if (!username || typeof username !== 'string') return false;
    return /^[a-zA-Z0-9_]{3,30}$/.test(username);
}

function validateEmail(email) {
    if (!email) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateRole(role) {
    return ['admin', 'employee'].includes(role);
}

// Rate limiting simple (по IP)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 минута
const MAX_REQUESTS_PER_MINUTE = 30;

function checkRateLimit(ip) {
    const now = Date.now();
    const requests = requestCounts.get(ip) || { count: 0, windowStart: now };
    
    if (now - requests.windowStart > RATE_LIMIT_WINDOW) {
        requests.count = 0;
        requests.windowStart = now;
    }
    
    requests.count++;
    requestCounts.set(ip, requests);
    
    return requests.count <= MAX_REQUESTS_PER_MINUTE;
}

module.exports = async (req, res) => {
  if (typeof res?.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  
  // Rate limiting
  const clientIP = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIP)) {
    return res.status(429).json({ error: "Too many requests. Try again later." });
  }
  
  // Limit body size
  const bodyStr = JSON.stringify(req.body || {});
  if (bodyStr.length > MAX_REQUEST_SIZE) {
    return res.status(400).json({ error: "Request too large" });
  }
  
  const debug = {
    method: req.method,
    table: TABLE_NAME,
    serverEnv: process.env.SEATABLE_SERVER || null,
    baseUuidPresent: Boolean(process.env.SEATABLE_BASE_UUID),
  };

  try {
    const accessMeta = await getAppAccessToken();
    const baseUrl = getRowsBaseUrl(accessMeta);
    const rowsUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}`;
    const rowsCreateUrl = `${baseUrl}/rows/`;
    const isV2 = baseUrl.includes("/api/v2/");

    console.log("[users] computed", {
      isV2,
      baseUrl,
      rowsUrl,
      rowsCreateUrl,
      table: TABLE_NAME,
    });

    async function fetchUserByRowId(rowId) {
      if (!rowId) return null;

      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT * FROM \`${TABLE_NAME}\` WHERE \`_id\` = ? LIMIT 1`,
            convert_keys: true,
            parameters: [rowId],
          }),
        });
        return Array.isArray(result?.results) && result.results.length ? result.results[0] : null;
      }

      const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
      const list = Array.isArray(rows) ? rows : rows?.rows || [];
      const found = list.find((item) => item?._id === rowId);
      return found ? (found.row || found) : null;
    }

    // GET - получить всех пользователей
    if (req.method === "GET") {
      let users = [];
      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT * FROM \`${TABLE_NAME}\` ORDER BY \`username\` ASC LIMIT 10000`,
            convert_keys: true,
          }),
        });
        const list = Array.isArray(result?.results) ? result.results : [];
        users = list.map(row => ({
          username: row.username,
          fullName: row.full_name,
          role: row.role || "employee",
          department: row.department || "",
          position: row.position || "",
          email: row.email || "",
          phone: row.phone || "",
          office: row.office || "",
          passwordHash: row.password_hash || "",
          avatar: row.avatar || ""
        }));
      } else {
        const limit = 1000;
        let start = 0;
        const all = [];
        while (true) {
          const pageUrl = `${rowsUrl}&start=${start}&limit=${limit}`;
          const rows = await seatableRequest(accessMeta.access_token, pageUrl, { method: "GET" });
          const list = Array.isArray(rows) ? rows : rows?.rows || [];
          if (!Array.isArray(list) || list.length === 0) break;
          all.push(...list);
          if (list.length < limit) break;
          start += limit;
        }
        users = all.map(row => {
          const source = row.row || row;
          return {
            username: source.username,
            fullName: source.full_name,
            role: source.role || "employee",
            department: source.department || "",
            position: source.position || "",
            email: source.email || "",
            phone: source.phone || "",
            office: source.office || "",
            passwordHash: source.password_hash || "",
            avatar: source.avatar || ""
};
        });
      }
      return res.status(200).json({ users });
    }

// POST - создать пользователя
    if (req.method === "POST") {
      const { user } = req.body;
      const username = String(user?.username || "").trim();
      
      // Input validation
      if (!username || !validateUsername(username)) {
        return res.status(400).json({ error: "Неверный логин (3-30 символов, a-z, 0-9, _)" });
      }
      if (user?.email && !validateEmail(user.email)) {
        return res.status(400).json({ error: "Неверный email" });
      }
      if (user?.role && !validateRole(user.role)) {
        return res.status(400).json({ error: "Неверная роль" });
      }

      // Защита от дублей на стороне API (SeaTable - источник истины).
      let existingRow = null;
      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT \`_id\` FROM \`${TABLE_NAME}\` WHERE \`username\` = ? LIMIT 1`,
            convert_keys: true,
            parameters: [username],
          }),
        });
        existingRow = Array.isArray(result?.results) && result.results.length ? result.results[0] : null;
      } else {
        const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
        const list = Array.isArray(rows) ? rows : rows?.rows || [];
        existingRow = list.find((item) => (item?.row || item)?.username === username) || null;
      }
      if (existingRow) {
        return res.status(409).json({ error: "Пользователь с таким логином уже существует" });
      }
      
      const row = {
        username,
        full_name: user.fullName,
        role: user.role || "employee",
        department: user.department || "",
        position: user.position || "",
        email: user.email || "",
        phone: user.phone || "",
        office: user.office || "",
        password_hash: user.passwordHash || ""
      };

      console.log("[users] creating", { username, role: user.role });

      let created;
      try {
        const body = isV2 ? { table_name: TABLE_NAME, rows: [row] } : { row };
        created = await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
          method: "POST",
          body: JSON.stringify(body),
        });
        
        // Для v2 рефетчим созданную запись
        if (isV2 && created?.rows?.[0]?._id) {
          const sqlUrl = `${baseUrl}/sql/`;
          const fetched = await seatableRequest(accessMeta.access_token, sqlUrl, {
            method: "POST",
            body: JSON.stringify({
              sql: `SELECT * FROM \`${TABLE_NAME}\` WHERE \`_id\` = ? LIMIT 1`,
              convert_keys: true,
              parameters: [created.rows[0]._id],
            }),
          });
          if (fetched?.results?.[0]) created = fetched.results[0];
        }
      } catch (firstError) {
        console.error("[users] create failed", { message: firstError?.message });
        throw firstError;
      }

      return res.status(201).json({ 
        success: true, 
        user: {
          username,
          fullName: user.fullName,
          role: user.role,
          department: user.department,
          position: user.position,
          email: user.email,
          phone: user.phone,
          office: user.office
        }
      });
    }

    // PUT - обновить пользователя
    if (req.method === "PUT") {
      // Vercel может передавать username в query или body
      const username = req.query?.username || req.body?.username;
      const { user } = req.body;

      if (!username) {
        return res.status(400).json({ error: "Требуется username" });
      }

      // Находим пользователя
      let existingUser = null;
      let rowId = null;
      
      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT * FROM \`${TABLE_NAME}\` WHERE \`username\` = ? LIMIT 1`,
            convert_keys: true,
            parameters: [username],
          }),
        });
        if (result?.results?.[0]) {
          existingUser = result.results[0];
          rowId = existingUser._id;
        }
      } else {
        const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
        const list = Array.isArray(rows) ? rows : rows?.rows || [];
        const found = list.find(r => (r.row || r).username === username);
        if (found) {
          existingUser = found.row || found;
          rowId = found._id;
        }
      }

      if (!rowId) {
        return res.status(404).json({ error: "Пользователь не найден" });
      }

      const row = {
        username: user.username || existingUser.username,
        full_name: user.fullName !== undefined ? user.fullName : existingUser.full_name,
        role: user.role || existingUser.role,
        department: user.department !== undefined ? user.department : existingUser.department,
        position: user.position !== undefined ? user.position : existingUser.position,
        email: user.email !== undefined ? user.email : existingUser.email,
        phone: user.phone !== undefined ? user.phone : existingUser.phone,
        office: user.office !== undefined ? user.office : existingUser.office,
        avatar: user.avatar !== undefined ? user.avatar : existingUser.avatar || "",
        ...(user.passwordHash ? { password_hash: user.passwordHash } : {})
      };

      console.log("[users] updating", { username, rowId, row });

      try {
        await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
          method: "PUT",
          body: JSON.stringify(buildUpdateRequestBody({
            isV2,
            tableName: TABLE_NAME,
            rowId,
            row,
          })),
        });
        // SeaTable Cloud can apply updates asynchronously; a strict immediate re-fetch check
        // can produce false negatives. We keep a best-effort verification, but never fail the request.
        try {
          const refreshedUser = await fetchUserByRowId(rowId);
          if (!refreshedUser) {
            console.warn("[users] update verification skipped: row not found after update", { username, rowId });
          } else {
            const userMatches =
              String(refreshedUser.username || "") === String(row.username || "") &&
              String(refreshedUser.full_name || "") === String(row.full_name || "") &&
              String(refreshedUser.role || "") === String(row.role || "") &&
              String(refreshedUser.department || "") === String(row.department || "") &&
              String(refreshedUser.position || "") === String(row.position || "") &&
              String(refreshedUser.email || "") === String(row.email || "") &&
              String(refreshedUser.phone || "") === String(row.phone || "") &&
              String(refreshedUser.office || "") === String(row.office || "");
            if (!userMatches) {
              console.warn("[users] update verification mismatch (may be eventual consistency)", {
                username,
                rowId,
              });
            } else {
              console.log("[users] update success", { username });
            }
          }
        } catch (verifyError) {
          console.warn("[users] update verification error (ignored)", { message: verifyError?.message || String(verifyError) });
        }
      } catch (updateError) {
        console.error("[users] update failed", { message: updateError?.message });
        throw updateError;
      }

      return res.status(200).json({ success: true });
    }

    // DELETE - удалить пользователя
    if (req.method === "DELETE") {
      // Vercel может передавать username в query
      const username = req.query?.username || req.body?.username;

      if (!username) {
        return res.status(400).json({ error: "Требуется username" });
      }

      // Находим row_id
      let rowId = null;
      
      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT \`_id\` FROM \`${TABLE_NAME}\` WHERE \`username\` = ? LIMIT 1`,
            convert_keys: true,
            parameters: [username],
          }),
        });
        if (result?.results?.[0]) {
          rowId = result.results[0]._id;
        }
      } else {
        const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
        const list = Array.isArray(rows) ? rows : rows?.rows || [];
        const found = list.find(r => (r.row || r).username === username);
        if (found) {
          rowId = found._id;
        }
      }

      if (!rowId) {
        return res.status(404).json({ error: "Пользователь не найден" });
      }

      await seatableRequest(accessMeta.access_token, rowsCreateUrl, {
        method: "DELETE",
        body: JSON.stringify(buildDeleteRequestBody({
          isV2,
          tableName: TABLE_NAME,
          rowId,
        })),
      });

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Метод не поддерживается" });
  } catch (error) {
    const message = error?.message || String(error);
    console.error("[users] handler failed", { message });
    return res.status(500).json({ error: message || "Unexpected API error", debug });
  }
};
