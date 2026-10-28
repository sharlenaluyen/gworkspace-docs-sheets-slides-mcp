import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { z } from "zod";

// google-mcp-accounts reads accounts.json from GOOGLE_MCP_DIR at import time,
// so give it a throwaway folder with one fake account before anything loads it.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "gws-create-"));
process.env.GOOGLE_MCP_DIR = configDir;
fs.writeFileSync(
  path.join(configDir, "accounts.json"),
  JSON.stringify({ work: { email: "work@example.com", refresh_token: "x", nicknames: ["job"], scopes: [] } })
);

// Stands in for clientFor, handing out whatever fake API a test set up, so
// no request ever reaches Google.
let fakeApis = {};
const clientCalls = [];
function clientFor(product, account) {
  clientCalls.push({ product, account });
  return fakeApis[product];
}

const { createToolDefiner } = await import("../src/mcp.js");
const {
  DOCS_ANNOTATIONS,
  registerDocsTools,
  MAX_TITLE_LENGTH: DOCS_MAX_TITLE,
} = await import("../src/docs.js");
const {
  SHEETS_ANNOTATIONS,
  registerSheetsTools,
  MAX_TITLE_LENGTH: SHEETS_MAX_TITLE,
} = await import("../src/sheets.js");

// Registers the real tools on a server that just records them, and an audit
// log that just collects its events.
function setup() {
  const tools = {};
  const audit = [];
  const server = {
    registerTool(name, config, handler) {
      tools[name] = { config, handler };
    },
  };
  const defineTool = createToolDefiner(server, { ...DOCS_ANNOTATIONS, ...SHEETS_ANNOTATIONS });
  const logAuditEvent = (event) => audit.push(event);
  registerDocsTools({ defineTool, logAuditEvent, clientFor });
  registerSheetsTools({ defineTool, logAuditEvent, clientFor });
  clientCalls.length = 0;
  return { tools, audit };
}

// Records each call and answers with `reply` (or throws it, if it's an Error).
function fakeMethod(reply) {
  const calls = [];
  const fn = async (params) => {
    calls.push(params);
    if (reply instanceof Error) throw reply;
    return { data: reply };
  };
  fn.calls = calls;
  return fn;
}

const parsed = (result) => JSON.parse(result.content[0].text);

test("create_doc creates a doc with the title and returns its id and edit link", async () => {
  const { tools, audit } = setup();
  const create = fakeMethod({ documentId: "doc123", title: "Plan" });
  fakeApis = { docs: { documents: { create } } };

  const result = await tools.create_doc.handler({ account: "job", title: "Plan" });

  assert.equal(result.isError, undefined);
  assert.deepEqual(parsed(result), {
    document_id: "doc123",
    title: "Plan",
    link: "https://docs.google.com/document/d/doc123/edit",
  });
  assert.deepEqual(create.calls, [{ requestBody: { title: "Plan" } }]);
  assert.deepEqual(clientCalls, [{ product: "docs", account: "job" }]);
  assert.deepEqual(audit, [
    {
      action: "create_doc",
      account: "work",
      email: "work@example.com",
      outcome: "created",
      detail: { document_id: "doc123" },
    },
  ]);
});

test("create_doc reports an API failure once, without retrying, and audits it", async () => {
  const { tools, audit } = setup();
  const create = fakeMethod(Object.assign(new Error("Backend Error"), { code: 503 }));
  fakeApis = { docs: { documents: { create } } };

  const result = await tools.create_doc.handler({ account: "work", title: "Plan" });

  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "create_doc failed: Backend Error");
  assert.equal(create.calls.length, 1);
  assert.deepEqual(audit, [
    {
      action: "create_doc",
      account: "work",
      email: "work@example.com",
      outcome: "error",
      detail: { error: "Backend Error" },
    },
  ]);
});

test("create_spreadsheet puts the title in properties and returns its id and edit link", async () => {
  const { tools, audit } = setup();
  const create = fakeMethod({ spreadsheetId: "sheet456", properties: { title: "Budget" } });
  fakeApis = { sheets: { spreadsheets: { create } } };

  const result = await tools.create_spreadsheet.handler({ account: "job", title: "Budget" });

  assert.equal(result.isError, undefined);
  assert.deepEqual(parsed(result), {
    spreadsheet_id: "sheet456",
    title: "Budget",
    link: "https://docs.google.com/spreadsheets/d/sheet456/edit",
  });
  assert.deepEqual(create.calls, [{ requestBody: { properties: { title: "Budget" } } }]);
  assert.deepEqual(clientCalls, [{ product: "sheets", account: "job" }]);
  assert.deepEqual(audit, [
    {
      action: "create_spreadsheet",
      account: "work",
      email: "work@example.com",
      outcome: "created",
      detail: { spreadsheet_id: "sheet456" },
    },
  ]);
});

test("create_spreadsheet reports an API failure once, without retrying, and audits it", async () => {
  const { tools, audit } = setup();
  const create = fakeMethod(Object.assign(new Error("Backend Error"), { code: 503 }));
  fakeApis = { sheets: { spreadsheets: { create } } };

  const result = await tools.create_spreadsheet.handler({ account: "work", title: "Budget" });

  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "create_spreadsheet failed: Backend Error");
  assert.equal(create.calls.length, 1);
  assert.deepEqual(audit, [
    {
      action: "create_spreadsheet",
      account: "work",
      email: "work@example.com",
      outcome: "error",
      detail: { error: "Backend Error" },
    },
  ]);
});

test("an unknown account is refused before any client is made or anything is audited", async () => {
  const { tools, audit } = setup();
  for (const name of ["create_doc", "create_spreadsheet"]) {
    const result = await tools[name].handler({ account: "nobody", title: "X" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Unknown account alias "nobody"/);
  }
  assert.deepEqual(clientCalls, []);
  assert.deepEqual(audit, []);
});

test("both create tools require a non-empty title within the length limit", () => {
  const { tools } = setup();
  for (const [name, max] of [
    ["create_doc", DOCS_MAX_TITLE],
    ["create_spreadsheet", SHEETS_MAX_TITLE],
  ]) {
    const schema = z.object(tools[name].config.inputSchema);
    assert.ok(schema.safeParse({ account: "work", title: "x".repeat(max) }).success, name);
    assert.ok(!schema.safeParse({ account: "work", title: "" }).success, name);
    assert.ok(!schema.safeParse({ account: "work", title: "x".repeat(max + 1) }).success, name);
    assert.ok(!schema.safeParse({ account: "work" }).success, name);
  }
});

test("both create tools are annotated as additive and not idempotent", () => {
  const { tools } = setup();
  for (const name of ["create_doc", "create_spreadsheet"]) {
    assert.deepEqual(tools[name].config.annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  }
});
