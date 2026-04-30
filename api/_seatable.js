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

function mapRowToTask(row) {
  // POST/GET v2 responses can vary; sometimes the returned object contains
  // a `rows` array or a wrapped `row`.
  const maybeWrapped = row && typeof row === "object" ? row : {};
  if (Array.isArray(maybeWrapped.rows) && maybeWrapped.rows.length === 1) {
    row = maybeWrapped.rows[0];
  }

  // SeaTable can return row data in different shapes depending on version/endpoint:
  // - flat: { _id, id, title, ... }
  // - wrapped: { _id, row: { id, title, ... } }
  const wrapper = row || {};
  const source = (wrapper && typeof wrapper === "object" && wrapper.row && typeof wrapper.row === "object") ? wrapper.row : wrapper;
  const parseJsonField = (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const normalizeDate = (value) => {
    if (!value) return "";
    const text = String(value).trim();
    if (!text) return "";
    const isoLike = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoLike) return isoLike[1];
    const ruLike = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (ruLike) return `${ruLike[3]}-${ruLike[2]}-${ruLike[1]}`;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return "";
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  return {
    row_id: wrapper._id || source._id || "",
    id: Number((source.id ?? source.ID ?? 0) || 0),
    createdAt: normalizeDate(source.created_at),
    updatedAt: normalizeDate(source.updated_at),
    databaseId: source.database_id || "db1",
    type: source.type || "",
    title: source.title || "",
    department: source.department || "",
    description: source.description || "",
    author: source.author || "",
    assignee: source.assignee || "",
    office: source.office || "",
    phone: source.phone || "",
    priority: source.priority || "Средний",
    status: source.status || "Новая",
    deadline: normalizeDate(source.deadline),
    slaDays: Number(source.sla_days || 3),
    assignedAt: normalizeDate(source.assigned_at),
    inProgressAt: normalizeDate(source.in_progress_at),
    reviewAt: normalizeDate(source.review_at),
    closedAt: normalizeDate(source.closed_at),
    rejectedAt: normalizeDate(source.rejected_at),
    rejectedReason: source.rejected_reason || "",
    report: source.report || "",
    comments: parseJsonField(source.comments),
    history: parseJsonField(source.history),
    attachments: parseJsonField(source.attachments),
  };
}

function mapTaskToRow(task) {
  const idNum = Number(task?.id);
  const createdAt = task.createdAt || task.created_at || new Date().toISOString().split('T')[0];
  return {
    ...(Number.isFinite(idNum) ? { id: idNum } : {}),
    created_at: createdAt,
    updated_at: task.updatedAt || new Date().toISOString().split('T')[0],
    database_id: task.databaseId || "db1",
    type: task.type || "",
    title: task.title || "",
    department: task.department || "",
    description: task.description || "",
    author: task.author || "",
    assignee: task.assignee || "",
    office: task.office || "",
    phone: task.phone || "",
    priority: task.priority || "Средний",
    status: task.status || "Новая",
    deadline: task.deadline || "",
    sla_days: Number(task.slaDays || 3),
    assigned_at: task.assignedAt || "",
    in_progress_at: task.inProgressAt || "",
    review_at: task.reviewAt || "",
    closed_at: task.closedAt || "",
    rejected_at: task.rejectedAt || "",
    rejected_reason: task.rejectedReason || "",
    report: task.report || "",
    comments: JSON.stringify(Array.isArray(task.comments) ? task.comments : []),
    history: JSON.stringify(Array.isArray(task.history) ? task.history : []),
    attachments: JSON.stringify(Array.isArray(task.attachments) ? task.attachments : []),
  };
}

function parseDataUrl(dataUrl) {
  const text = String(dataUrl || "");
  const match = text.match(/^data:([^;,]+)?;base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1] || "application/octet-stream",
    base64: match[2],
  };
}

async function uploadAttachmentToSeaTable(accessMeta, attachment) {
  const source = attachment && typeof attachment === "object" ? attachment : {};
  const hasRemoteUrl = typeof source.url === "string" && source.url.trim() && !source.url.startsWith("data:");
  if (hasRemoteUrl) {
    const normalized = {
      name: source.name || "attachment",
      url: source.url,
      size: Number(source.size || 0) || 0,
      type: source.type || "",
    };
    if (source.createdAt) normalized.createdAt = String(source.createdAt);
    if (source.author) normalized.author = String(source.author);
    return normalized;
  }

  const rawDataUrl = typeof source.dataUrl === "string" ? source.dataUrl : String(source.url || "");
  const parsed = parseDataUrl(rawDataUrl);
  if (!parsed) {
    return {
      name: source.name || "attachment",
      url: String(source.url || ""),
      size: Number(source.size || 0) || 0,
      type: source.type || "",
    };
  }

  const uploadMetaUrl = `${getServerBase()}/api/v2.1/dtable/app-upload-link/`;
  const uploadMeta = await seatableRequest(accessMeta.access_token, uploadMetaUrl, { method: "GET" });
  const uploadLink = uploadMeta?.upload_link || uploadMeta?.url;
  if (!uploadLink) {
    throw new Error("SeaTable upload link is missing");
  }

  const buffer = Buffer.from(parsed.base64, "base64");
  const extByMime = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/pdf": "pdf",
  };
  const fallbackExt = extByMime[parsed.mimeType] || "bin";
  const fileName = String(source.name || `attachment-${Date.now()}.${fallbackExt}`);
  const formData = new FormData();
  formData.append("file", new Blob([buffer], { type: parsed.mimeType }), fileName);
  if (uploadMeta?.parent_path) {
    formData.append("parent_dir", String(uploadMeta.parent_path));
  }

  let uploadResponse = await fetch(uploadLink, { method: "POST", body: formData });
  if (!uploadResponse.ok) {
    uploadResponse = await fetch(uploadLink, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessMeta.access_token}` },
      body: formData,
    });
  }
  if (!uploadResponse.ok) {
    const body = await uploadResponse.text();
    throw new Error(`SeaTable attachment upload failed: ${uploadResponse.status} ${body}`);
  }

  const uploaded = await uploadResponse.json();
  let url = uploaded?.url || uploaded?.download_link || uploaded?.file_url || "";
  if (url && !/^https?:\/\//i.test(url)) {
    if (!url.startsWith("/")) url = `/${url}`;
    url = `${getServerBase()}${url}`;
  }
  const normalized = {
    name: uploaded?.name || fileName,
    url,
    size: Number(uploaded?.size || buffer.length) || buffer.length,
    type: uploaded?.type || parsed.mimeType || source.type || "",
  };
  if (source.createdAt) normalized.createdAt = String(source.createdAt);
  if (source.author) normalized.author = String(source.author);
  return normalized;
}

async function normalizeAttachmentsForSeaTable(accessMeta, attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const normalized = [];
  for (const item of list) {
    try {
      normalized.push(await uploadAttachmentToSeaTable(accessMeta, item));
    } catch (error) {
      console.warn("[seatable] attachment upload failed; keep existing value", {
        message: error?.message || String(error),
      });
      normalized.push({
        name: String(item?.name || "attachment"),
        url: String(item?.url || item?.dataUrl || ""),
        size: Number(item?.size || 0) || 0,
        type: String(item?.type || ""),
        ...(item?.createdAt ? { createdAt: String(item.createdAt) } : {}),
        ...(item?.author ? { author: String(item.author) } : {}),
      });
    }
  }
  return normalized;
}

function buildUpdateRequestBody({ isV2, tableName, rowId, row }) {
  if (!rowId) {
    throw new Error("rowId is required for update body");
  }

  return isV2
    ? {
        table_name: tableName,
        updates: [{ row_id: rowId, row }],
      }
    : {
        row_id: rowId,
        row,
      };
}

function buildDeleteRequestBody({ isV2, tableName, rowId }) {
  if (!rowId) {
    throw new Error("rowId is required for delete body");
  }

  return isV2
    ? {
        table_name: tableName,
        row_ids: [rowId],
      }
    : {
        row_id: rowId,
      };
}

module.exports = {
  buildDeleteRequestBody,
  buildUpdateRequestBody,
  getAppAccessToken,
  getRowsBaseUrl,
  mapRowToTask,
  mapTaskToRow,
  normalizeAttachmentsForSeaTable,
  seatableRequest,
};