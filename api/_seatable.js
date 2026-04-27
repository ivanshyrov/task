const REQUIRED_ENV = ["SEATABLE_API_TOKEN", "SEATABLE_BASE_UUID"];
const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1000;

// Best-effort in-memory cache for app access token.
let cachedAccessMeta = null;
let cachedAccessMetaExpiresAt = 0;
let cachedAccessMetaKey = "";

function assertEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}

function getServerBase() {
  const base = process.env.SEATABLE_SERVER || "https://cloud.seatable.io";
  return base.replace(/\/+$/, "");
}

async function getAppAccessToken() {
  assertEnv();
  const cacheKey = `${getServerBase()}|${String(process.env.SEATABLE_BASE_UUID || "")}|${String(process.env.SEATABLE_API_TOKEN || "").slice(0, 8)}`;
  const now = Date.now();
  if (cachedAccessMeta && cachedAccessMetaKey === cacheKey && cachedAccessMetaExpiresAt - now > 60_000) {
    return cachedAccessMeta;
  }
  const url = `${getServerBase()}/api/v2.1/dtable/app-access-token/`;
  console.log("[seatable] auth start", {
    serverBase: getServerBase(),
    baseUuidPresent: Boolean(process.env.SEATABLE_BASE_UUID),
  });
  
  const serverBase = getServerBase();
  const useGetAuth = serverBase.includes('cloud.seatable.io');
  
  let response;
  let lastError;
  
  // Retry logic for network failures
  for (let attempt = 0; attempt < DEFAULT_RETRY_COUNT; attempt++) {
    try {
      if (useGetAuth) {
        // Cloud SeaTable requires GET with Authorization header
        response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Token ${process.env.SEATABLE_API_TOKEN}`,
            "Content-Type": "application/json"
          },
          // some fetch implementations ignore timeout option; we handle timeouts in seatableRequest too
        });
        console.log("[seatable] auth response (GET)", { status: response.status, attempt: attempt + 1 });
      } else {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_token: process.env.SEATABLE_API_TOKEN }),
        });
        console.log("[seatable] auth response (POST)", { status: response.status, attempt: attempt + 1 });
      }
      
      if (response.ok) break;
      
      if (attempt < DEFAULT_RETRY_COUNT - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
      }
    } catch (e) {
      lastError = e;
      if (attempt < DEFAULT_RETRY_COUNT - 1) {
        console.warn(`[seatable] auth attempt ${attempt + 1} failed, retrying...`, { error: e.message || e });
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }

  if (response && response.ok) {
    const meta = await response.json();
    const expireInSec = Number(meta?.expire_in || meta?.expires_in || 0) || 0;
    // Keep a safety buffer of 60s.
    cachedAccessMeta = meta;
    cachedAccessMetaKey = cacheKey;
    cachedAccessMetaExpiresAt = now + Math.max(0, expireInSec * 1000 - 60_000);
    return meta;
  }

  if (lastError) {
    throw new Error(`SeaTable auth failed after ${DEFAULT_RETRY_COUNT} attempts: ${lastError.message || lastError}`);
  }

  const body = await response?.text?.() || "Unknown error";
  throw new Error(`SeaTable auth failed: ${response?.status || "Network error"} ${body}`);
}

function getRowsBaseUrl(accessMeta) {
  const dtableServer = (accessMeta.dtable_server || getServerBase()).replace(/\/+$/, "");
  const dtableUuid = accessMeta.dtable_uuid || process.env.SEATABLE_BASE_UUID;
  console.log("[seatable] rows base inputs", {
    dtableServer,
    hasMetaUuid: Boolean(accessMeta && accessMeta.dtable_uuid),
    envUuidPresent: Boolean(process.env.SEATABLE_BASE_UUID),
  });
  if (dtableServer.includes("/api-gateway")) {
    return `${dtableServer}/api/v2/dtables/${dtableUuid}`;
  }
  return `${dtableServer}/api/v1/dtables/${dtableUuid}`;
}

async function seatableRequest(accessToken, url, options = {}) {
  const timeoutMs =
    Number(options?.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRetries = Number(options?.maxRetries) > 0 ? Number(options.maxRetries) : DEFAULT_RETRY_COUNT;
  
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const makeRequest = (scheme) =>
      fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `${scheme} ${accessToken}`,
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });

    const preferBearer = url.includes("/api/v2/") || url.includes("/api-gateway/");
    const primaryScheme = preferBearer ? "Bearer" : "Token";
    const fallbackScheme = preferBearer ? "Token" : "Bearer";

    let response;
    try {
      response = await makeRequest(primaryScheme);
      if (response.status === 401 || response.status === 403) {
        response = await makeRequest(fallbackScheme);
      }
      
      if (response.ok || response.status === 204) {
        clearTimeout(timeout);
        if (response.status === 204) return null;
        return response.json();
      }
      
      // Retry on server errors
      if (response.status >= 500 && attempt < maxRetries - 1) {
        console.warn(`[seatable] Server error ${response.status}, retrying attempt ${attempt + 1}...`);
        clearTimeout(timeout);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      
      clearTimeout(timeout);
      const body = await response.text();
      throw new Error(`SeaTable request failed: ${response.status} ${body}`);
    } catch (e) {
      clearTimeout(timeout);
      lastError = e;
      if (e?.name === "AbortError") {
        if (attempt < maxRetries - 1) {
          console.warn(`[seatable] Request timeout (${timeoutMs}ms), retrying attempt ${attempt + 1}...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
        throw new Error(`SeaTable request timeout after ${timeoutMs}ms (${maxRetries} attempts)`);
      }
      if (attempt < maxRetries - 1) {
        console.warn(`[seatable] Network error on attempt ${attempt + 1}, retrying...`, { error: e.message || e });
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  
  throw lastError || new Error("SeaTable request failed after all retry attempts");
}

// mapping and helpers (unchanged)...
// paste your existing mapRowToTask, mapTaskToRow, buildUpdateRequestBody, buildDeleteRequestBody here
// and export them with seatableRequest

module.exports = {
  buildDeleteRequestBody,
  buildUpdateRequestBody,
  getAppAccessToken,
  getRowsBaseUrl,
  mapRowToTask,
  mapTaskToRow,
  seatableRequest,
};