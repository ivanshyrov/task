const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  buildDeleteRequestBody,
  buildUpdateRequestBody,
  mapRowToTask,
  mapTaskToRow,
} = require("../api/_seatable");

function createRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

function loadHandlerWithMock(handlerRelativePath, mockedSeatable) {
  const seatablePath = require.resolve("../api/_seatable");
  const handlerPath = path.resolve(__dirname, "..", handlerRelativePath);
  const previousSeatableModule = require.cache[seatablePath];

  require.cache[seatablePath] = {
    id: seatablePath,
    filename: seatablePath,
    loaded: true,
    exports: mockedSeatable,
  };

  delete require.cache[handlerPath];
  const handler = require(handlerPath);

  return {
    handler,
    restore() {
      delete require.cache[handlerPath];
      if (previousSeatableModule) {
        require.cache[seatablePath] = previousSeatableModule;
      } else {
        delete require.cache[seatablePath];
      }
    },
  };
}

test("mapRowToTask normalizes wrapped rows and parses json arrays", () => {
  const task = mapRowToTask({
    _id: "row-123",
    row: {
      id: 7,
      created_at: "2026-04-27",
      title: "Test task",
      comments: '[{"text":"hello"}]',
      history: '[{"type":"status"}]',
      attachments: '[{"name":"file.txt"}]',
    },
  });

  assert.equal(task.row_id, "row-123");
  assert.equal(task.id, 7);
  assert.equal(task.title, "Test task");
  assert.deepEqual(task.comments, [{ text: "hello" }]);
  assert.deepEqual(task.history, [{ type: "status" }]);
  assert.deepEqual(task.attachments, [{ name: "file.txt" }]);
});

test("mapTaskToRow serializes arrays for SeaTable", () => {
  const row = mapTaskToRow({
    id: 9,
    createdAt: "2026-04-27",
    title: "Serialized task",
    comments: [{ text: "a" }],
    history: [{ type: "created" }],
    attachments: [{ name: "doc.pdf" }],
  });

  assert.equal(row.id, 9);
  assert.equal(row.created_at, "2026-04-27");
  assert.equal(row.title, "Serialized task");
  assert.equal(row.comments, '[{"text":"a"}]');
  assert.equal(row.history, '[{"type":"created"}]');
  assert.equal(row.attachments, '[{"name":"doc.pdf"}]');
});

test("buildUpdateRequestBody uses SeaTable v2 updates format", () => {
  const body = buildUpdateRequestBody({
    isV2: true,
    tableName: "Tasks",
    rowId: "row-1",
    row: { title: "Updated" },
  });

  assert.deepEqual(body, {
    table_name: "Tasks",
    updates: [{ row_id: "row-1", row: { title: "Updated" } }],
  });
});

test("buildUpdateRequestBody uses self-hosted v1 update format", () => {
  const body = buildUpdateRequestBody({
    isV2: false,
    tableName: "Tasks",
    rowId: "row-2",
    row: { title: "Updated" },
  });

  assert.deepEqual(body, {
    row_id: "row-2",
    row: { title: "Updated" },
  });
});

test("buildDeleteRequestBody uses correct v2 format", () => {
  const body = buildDeleteRequestBody({
    isV2: true,
    tableName: "Users",
    rowId: "user-row",
  });

  assert.deepEqual(body, {
    table_name: "Users",
    row_ids: ["user-row"],
  });
});

test("tasks api PUT sends SeaTable v2 updates payload", async () => {
  const calls = [];
  const mockedSeatable = {
    buildDeleteRequestBody,
    buildUpdateRequestBody,
    getAppAccessToken: async () => ({
      access_token: "token",
      dtable_server: "https://cloud.seatable.io/api-gateway/",
      dtable_uuid: "base-1",
    }),
    getRowsBaseUrl: () => "https://cloud.seatable.io/api-gateway/api/v2/dtables/base-1",
    mapRowToTask,
    mapTaskToRow,
    seatableRequest: async (token, url, options) => {
      calls.push({ token, url, options });
      if (url.endsWith("/sql/")) {
        return {
          results: [
            {
              _id: "row-2",
              id: 2,
              created_at: new Date().toISOString().split("T")[0],
              updated_at: new Date().toISOString().split("T")[0],
              database_id: "db1",
              type: "Прочее",
              title: "Updated task",
              department: "",
              description: "",
              author: "",
              assignee: "",
              office: "",
              phone: "",
              priority: "Средний",
              status: "Новая",
              deadline: "",
              sla_days: 3,
              assigned_at: "",
              in_progress_at: "",
              review_at: "",
              closed_at: "",
              rejected_at: "",
              rejected_reason: "",
              report: "",
              comments: "[]",
              history: "[]",
              attachments: "[]",
            },
          ],
        };
      }
      return { success: true };
    },
  };

  const { handler, restore } = loadHandlerWithMock("api/tasks/index.js", mockedSeatable);

  try {
    const req = {
      method: "PUT",
      body: {
        id: 2,
        row_id: "row-2",
        title: "Updated task",
        status: "Новая",
      },
    };
    const res = createRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.method, "PUT");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      table_name: "Tasks",
      updates: [
        {
          row_id: "row-2",
          row: {
            id: 2,
            created_at: new Date().toISOString().split("T")[0],
            updated_at: new Date().toISOString().split("T")[0],
            database_id: "db1",
            type: "Прочее",
            title: "Updated task",
            department: "",
            description: "",
            author: "",
            assignee: "",
            office: "",
            phone: "",
            priority: "Средний",
            status: "Новая",
            deadline: "",
            sla_days: 3,
            assigned_at: "",
            in_progress_at: "",
            review_at: "",
            closed_at: "",
            rejected_at: "",
            rejected_reason: "",
            report: "",
            comments: "[]",
            history: "[]",
            attachments: "[]",
          },
        },
      ],
    });
    assert.equal(calls[1].options.method, "POST");
  } finally {
    restore();
  }
});

test("task by id api DELETE resolves row id and sends v2 delete payload", async () => {
  const calls = [];
  const mockedSeatable = {
    buildDeleteRequestBody,
    buildUpdateRequestBody,
    getAppAccessToken: async () => ({
      access_token: "token",
      dtable_server: "https://cloud.seatable.io/api-gateway/",
      dtable_uuid: "base-1",
    }),
    getRowsBaseUrl: () => "https://cloud.seatable.io/api-gateway/api/v2/dtables/base-1",
    mapRowToTask,
    mapTaskToRow,
    seatableRequest: async (token, url, options) => {
      calls.push({ token, url, options });
      if (url.endsWith("/sql/")) {
        return { results: [{ _id: "resolved-row-id", id: 15 }] };
      }
      return { deleted_rows: 1 };
    },
  };

  const { handler, restore } = loadHandlerWithMock("api/tasks/[id].js", mockedSeatable);

  try {
    const req = {
      method: "DELETE",
      query: { id: "15" },
      body: {},
    };
    const res = createRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[1].options.method, "DELETE");
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      table_name: "Tasks",
      row_ids: ["resolved-row-id"],
    });
  } finally {
    restore();
  }
});

test("users api PUT finds row by username and sends SeaTable v2 updates payload", async () => {
  const calls = [];
  const mockedSeatable = {
    buildDeleteRequestBody,
    buildUpdateRequestBody,
    getAppAccessToken: async () => ({
      access_token: "token",
      dtable_server: "https://cloud.seatable.io/api-gateway/",
      dtable_uuid: "base-1",
    }),
    getRowsBaseUrl: () => "https://cloud.seatable.io/api-gateway/api/v2/dtables/base-1",
    seatableRequest: async (token, url, options) => {
      calls.push({ token, url, options });
      if (url.endsWith("/sql/") && calls.length === 1) {
        return {
          results: [
            {
              _id: "user-row-1",
              username: "old-login",
              full_name: "Old Name",
              role: "employee",
              department: "IT",
              position: "",
              email: "",
              phone: "",
            },
          ],
        };
      }
      if (url.endsWith("/sql/")) {
        return {
          results: [
            {
              _id: "user-row-1",
              username: "new-login",
              full_name: "New Name",
              role: "employee",
              department: "Support",
              position: "",
              email: "new@example.com",
              phone: "",
            },
          ],
        };
      }
      return { success: true };
    },
  };

  const { handler, restore } = loadHandlerWithMock("api/users/index.js", mockedSeatable);

  try {
    const req = {
      method: "PUT",
      query: { username: "old-login" },
      body: {
        username: "old-login",
        user: {
          username: "new-login",
          fullName: "New Name",
          department: "Support",
          role: "employee",
          email: "new@example.com",
        },
      },
    };
    const res = createRes();

    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[1].options.method, "PUT");
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      table_name: "Users",
      updates: [
        {
          row_id: "user-row-1",
          row: {
            username: "new-login",
            full_name: "New Name",
            role: "employee",
            department: "Support",
            position: "",
            email: "new@example.com",
            phone: "",
          },
        },
      ],
    });
    assert.equal(calls[2].options.method, "POST");
  } finally {
    restore();
  }
});
