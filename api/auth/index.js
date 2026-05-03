const {
  getAppAccessToken,
  getRowsBaseUrl,
  seatableRequest,
} = require("../_seatable");

const TABLE_NAME = process.env.SEATABLE_USERS_TABLE || "Users";
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 час

// In-memory токены (сбрасываются при cold start)
const validTokens = new Map();

// Rate limiting для login
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 минут

function hashPassword(password) {
  // Web Crypto API - SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  return crypto.subtle.digest('SHA-256', data).then(buffer => {
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  });
}

function generateToken() {
  return crypto.randomUUID();
}

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  
  if (now < attempts.lockedUntil) {
    return { allowed: false, remaining: Math.ceil((attempts.lockedUntil - now) / 1000) };
  }
  
  if (now - attempts.lockedUntil > LOGIN_LOCKOUT_MS) {
    attempts.count = 0;
    attempts.lockedUntil = 0;
  }
  
  return { allowed: true, remaining: MAX_LOGIN_ATTEMPTS - attempts.count };
}

function recordFailedLogin(ip) {
  const attempts = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  attempts.count++;
  
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
  }
  
  loginAttempts.set(ip, attempts);
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function validateToken(token) {
  if (!token) return null;
  const data = validTokens.get(token);
  if (!data) return null;
  
  if (Date.now() > data.expiresAt) {
    validTokens.delete(token);
    return null;
  }
  
  // Продлеваем TTL при активности
  data.expiresAt = Date.now() + TOKEN_TTL_MS;
  return data.user;
}

function createToken(user) {
  const token = generateToken();
  validTokens.set(token, {
    user: {
      username: user.username,
      role: user.role,
      fullName: user.full_name,
    },
    createdAt: Date.now(),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return token;
}

function revokeToken(token) {
  if (token) {
    validTokens.delete(token);
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  
  const clientIP = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown';
  
  // CORS
  const origin = req.headers?.origin || "";
  const allowOrigin = origin || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  try {
    // POST - login
    if (req.method === "POST") {
      const rateCheck = checkLoginRateLimit(clientIP);
      if (!rateCheck.allowed) {
        return res.status(429).json({ 
          error: "Слишком много попыток", 
          retryAfter: rateCheck.remaining 
        });
      }
      
      const { login, password } = req.body || {};
      
      if (!login || !password) {
        recordFailedLogin(clientIP);
        return res.status(400).json({ error: "Требуются login и password" });
      }
      
      const accessMeta = await getAppAccessToken();
      const baseUrl = getRowsBaseUrl(accessMeta);
      const isV2 = baseUrl.includes("/api/v2/");
      
      let user = null;
      
      if (isV2) {
        const sqlUrl = `${baseUrl}/sql/`;
        const result = await seatableRequest(accessMeta.access_token, sqlUrl, {
          method: "POST",
          body: JSON.stringify({
            sql: `SELECT * FROM \`${TABLE_NAME}\` WHERE \`username\` = ? LIMIT 1`,
            convert_keys: true,
            parameters: [login],
          }),
        });
        
        const row = result?.results?.[0];
        if (row) {
          user = {
            username: row.username,
            passwordHash: row.password_hash,
            role: row.role || "employee",
            fullName: row.full_name,
          };
        }
      } else {
        const rowsUrl = `${baseUrl}/rows/?table_name=${encodeURIComponent(TABLE_NAME)}`;
        const rows = await seatableRequest(accessMeta.access_token, rowsUrl, { method: "GET" });
        const list = Array.isArray(rows) ? rows : rows?.rows || [];
        const found = list.find(r => r.username === login);
        if (found) {
          user = {
            username: found.username,
            passwordHash: found.password_hash,
            role: found.role || "employee",
            fullName: found.full_name,
          };
        }
      }
      
      if (!user) {
        recordFailedLogin(clientIP);
        return res.status(401).json({ error: "Неверные учётные данные" });
      }
      
      // Проверяем пароль
      const passwordHash = await hashPassword(password);
      
      if (passwordHash !== user.passwordHash) {
        recordFailedLogin(clientIP);
        return res.status(401).json({ error: "Неверные учётные данные" });
      }
      
      clearLoginAttempts(clientIP);
      
      const token = createToken(user);
      
      return res.status(200).json({
        token,
        user: {
          username: user.username,
          role: user.role,
          fullName: user.fullName,
        },
        expiresIn: TOKEN_TTL_MS,
      });
    }
    
    // DELETE - logout
    if (req.method === "DELETE") {
      const auth = req.headers?.authorization || "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      
      if (token) {
        revokeToken(token);
      }
      
      return res.status(200).json({ success: true });
    }
    
    // GET - verify token
    if (req.method === "GET") {
      const auth = req.headers?.authorization || "";
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      
      if (!token) {
        return res.status(401).json({ error: "Требуется токен" });
      }
      
      const user = validateToken(token);
      
      if (!user) {
        return res.status(401).json({ error: "Недействительный токен" });
      }
      
      return res.status(200).json({ user });
    }
    
    return res.status(405).json({ error: "Метод не поддерживается" });
    
  } catch (error) {
    console.error("[auth] error", { message: error?.message });
    return res.status(500).json({ error: "Ошибка сервера" });
  }
};