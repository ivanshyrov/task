const REQUIRED_ENV = ["SEATABLE_API_TOKEN", "SEATABLE_BASE_UUID"];

function assertEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}

function getServerBase() {
  const base = process.env.SEATABLE_SERVER || "https://seatable.spyanao.ru";
  return base.replace(/\/+$/, "");
}

async function getAppAccessToken() {
  assertEnv();
  const url = `${getServerBase()}/api/v2.1/dtable/app-access-token/`;
  const postResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_token: process.env.SEATABLE_API_TOKEN }),
  });

  if (postResponse.ok) return postResponse.json();

  // Some SeaTable installations expect GET + Authorization header.
  if (postResponse.status === 405) {
    const getResponse = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Token ${process.env.SEATABLE_API_TOKEN}` },
    });
    if (getResponse.ok) return getResponse.json();
    const getBody = await getResponse.text();
    throw new Error(`SeaTable auth failed (GET): ${getResponse.status} ${getBody}`);
  }

  const postBody = await postResponse.text();
  throw new Error(`SeaTable auth failed (POST): ${postResponse.status} ${postBody}`);
}

function getRowsBaseUrl(accessMeta) {
  const dtableServer = (accessMeta.dtable_server || getServerBase()).replace(/\/+$/, "");
  const dtableUuid = accessMeta.dtable_uuid || process.env.SEATABLE_BASE_UUID;
  return `${dtableServer}/api/v1/dtables/${dtableUuid}`;
}

async function seatableRequest(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Token ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`SeaTable request failed: ${response.status} ${body}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

function mapRowToTask(row) {
  const source = row || {};
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
  return {
    row_id: source._id || "",
    id: Number(source.id || 0),
    createdAt: source.created_at || "",
    updatedAt: source.updated_at || "",
    databaseId: source.database_id || "db1",
    type: source.type || "Прочее",
    title: source.title || "",
    department: source.department || "",
    description: source.description || "",
    author: source.author || "",
    assignee: source.assignee || "",
    office: source.office || "",
    phone: source.phone || "",
    priority: source.priority || "Средний",
    status: source.status || "Новая",
    deadline: source.deadline || "",
    slaDays: Number(source.sla_days || 3),
    assignedAt: source.assigned_at || "",
    inProgressAt: source.in_progress_at || "",
    reviewAt: source.review_at || "",
    closedAt: source.closed_at || "",
    rejectedAt: source.rejected_at || "",
    rejectedReason: source.rejected_reason || "",
    report: source.report || "",
    comments: parseJsonField(source.comments),
    history: parseJsonField(source.history),
    attachments: parseJsonField(source.attachments),
  };
}

function mapTaskToRow(task) {
  return {
    id: Number(task.id),
    created_at: task.createdAt || "",
    updated_at: task.updatedAt || "",
    database_id: task.databaseId || "db1",
    type: task.type || "Прочее",
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

module.exports = {
  getAppAccessToken,
  getRowsBaseUrl,
  mapRowToTask,
  mapTaskToRow,
  seatableRequest,
};
