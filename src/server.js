#!/usr/bin/env node
// One MCP server for Google's "Workspace Editors": Docs, Sheets and Slides.
// Each product's tools live in their own module; this file wires them into a
// single server process.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  getConnectedAliases,
  getAccountInfo,
  missingScopes,
  REQUIRED_SCOPES,
  createAuditLogger,
} from "google-mcp-accounts";
import { accountInstructions, createToolDefiner, jsonResult } from "./mcp.js";
import { DOCS_ANNOTATIONS, registerDocsTools } from "./docs.js";
import { SHEETS_ANNOTATIONS, registerSheetsTools } from "./sheets.js";
import { SLIDES_ANNOTATIONS, registerSlidesTools } from "./slides.js";

const server = new McpServer(
  { name: "gworkspace-docs-sheets-slides-mcp", version: "1.0.0" },
  { instructions: accountInstructions() }
);

// Shared ~/.google-mcp/audit.log, every line tagged with this server's name.
const logAuditEvent = createAuditLogger("gworkspace-docs-sheets-slides-mcp");

// MCP tool annotations: hints that let the client (Claude Desktop) decide
// which calls to auto-approve and which always need the user's OK. Every
// tool must have an entry; defineTool refuses one that doesn't.
const TOOL_ANNOTATIONS = {
  list_accounts: { readOnlyHint: true, openWorldHint: false },
  ...DOCS_ANNOTATIONS,
  ...SHEETS_ANNOTATIONS,
  ...SLIDES_ANNOTATIONS,
};
const defineTool = createToolDefiner(server, TOOL_ANNOTATIONS);

defineTool(
  "list_accounts",
  "List every Google account connected to this server, with its alias, nicknames, email, and which of Docs, Sheets and Slides it has granted access to. A nickname can be passed anywhere an alias is accepted. Always call this first if you don't already know the aliases.",
  {},
  async () => {
    const accounts = getConnectedAliases().map((alias) => {
      const info = getAccountInfo(alias);
      const products = ["docs", "sheets", "slides"].filter(
        (p) => !missingScopes(info, REQUIRED_SCOPES[p]).length
      );
      return { alias, nicknames: info.nicknames, email: info.email, can_use: products };
    });
    return jsonResult({ accounts });
  }
);

registerDocsTools({ defineTool, logAuditEvent });
registerSheetsTools({ defineTool, logAuditEvent });
registerSlidesTools({ defineTool, logAuditEvent });

const transport = new StdioServerTransport();
await server.connect(transport);
