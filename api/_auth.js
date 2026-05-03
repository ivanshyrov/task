// Auth middleware - проверка токена
// Использование: require("./_auth").verifyAuth(req, res)

const {
  getAppAccessToken,
  getRowsBaseUrl,
  seatableRequest,
} = require("./_seatable");

const TABLE_NAME = process.env.SEATABLE_USERS_TABLE || "Users";
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 час

const validTokens = new Map();

function generateToken() {
  return crypto.randomUUID();
}

function validateToken(token) {
  if (!token) return null;
  const data = validTokens.get(token);
  if (!data) return null;
  
  if (Date.now() > data.expiresAt) {
    validTokens.delete(token);
    return null;
  }
  
  data.expiresAt = Date.now() + TOKEN_TTL_MS;
  return data.user;
}

function createTokenForUser(user) {
  const token = generateToken();
  validTokens.set(token, {
    user: {
      username: user.username,
      role: user.role,
      fullName: user.fullName,
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

// Middleware функция для проверки авторизации
function verifyAuth(req, res, options = {}) {
  return new Promise((resolve, reject) => {
    const auth = req.headers?.authorization || req.headers?.Authorization || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    
    if (!token) {
      if (options.optional) {
        resolve(null);
        return;
      }
      res.status(401).json({ error: "Требуется авторизация" });
      reject(new Error("No token"));
      return;
    }
    
    const user = validateToken(token);
    
    if (!user) {
      res.status(401).json({ error: "Недействительный токен" });
      reject(new Error("Invalid token"));
      return;
    }
    
    req.user = user;
    resolve(user);
  });
}

// Проверка роли
function requireRole(req, res, requiredRole) {
  return verifyAuth(req, res).then(user => {
    if (requiredRole && user.role !== requiredRole) {
      throw new Error("Недостаточно прав");
    }
    return user;
  });
}

module.exports = {
  validateToken,
  createTokenForUser,
  revokeToken,
  verifyAuth,
  requireRole,
  TOKEN_TTL_MS,
};