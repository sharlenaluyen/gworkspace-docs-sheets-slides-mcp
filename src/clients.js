import { google } from "googleapis";
import {
  getAccountInfo,
  createAuthClient,
  hasScope,
  REQUIRED_SCOPES,
  DRIVE_READONLY_SCOPE,
} from "google-mcp-accounts";

// One Google API per product, each checked against its own scope, so an
// account that granted Sheets but not Slides can still use the Sheets tools.
// Drive is only used for export_presentation.
const FACTORIES = {
  docs: (auth) => google.docs({ version: "v1", auth }),
  sheets: (auth) => google.sheets({ version: "v4", auth }),
  slides: (auth) => google.slides({ version: "v1", auth }),
  drive: (auth) => google.drive({ version: "v3", auth }),
};

// Cache one authed client per product and account (main alias) per process run.
const clientCache = new Map();

export function clientFor(product, name) {
  const { alias } = getAccountInfo(name);
  const key = `${product}:${alias}`;
  if (clientCache.has(key)) return clientCache.get(key);
  const auth = createAuthClient(alias, {
    OAuth2: google.auth.OAuth2,
    requiredScopes: REQUIRED_SCOPES[product],
  });
  const client = FACTORIES[product](auth);
  clientCache.set(key, client);
  return client;
}

// Docs, Sheets and Slides ids are all Drive file ids.
export const GOOGLE_FILE_ID = /^[A-Za-z0-9_-]{1,200}$/;

// Under drive.file, Drive can only export files these servers created or
// opened; the Slides API (presentations scope) can read any deck. Say so
// instead of leaving a bare 404.
export function explainExportError(err, info) {
  const status = err?.code || err?.response?.status;
  if ((status === 404 || status === 403) && !hasScope(info, DRIVE_READONLY_SCOPE)) {
    err.message =
      `${err.message} - Exporting goes through Drive, and with only drive.file access Drive can reach decks these Google MCP servers created or opened (e.g. with create_presentation), not others. ` +
      `To export any deck, re-authorize this account once with: node auth.js ${info.alias} --with-drive-readonly (in google-mcp-accounts).`;
  }
  return err;
}
