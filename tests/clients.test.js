import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { GOOGLE_FILE_ID, explainExportError } from "../src/clients.js";

const G = "https://www.googleapis.com/auth/";

test("GOOGLE_FILE_ID accepts Docs/Sheets/Slides ids and rejects anything path- or URL-like", () => {
  assert.ok(GOOGLE_FILE_ID.test("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"));
  for (const bad of ["../x", "a/b", "https://docs.google.com/x", "a b", ""]) {
    assert.ok(!GOOGLE_FILE_ID.test(bad), bad);
  }
});

test("explainExportError explains drive.file's limits only when that's the likely cause", () => {
  const fileOnly = { alias: "work", scopes: [`${G}drive.file`] };
  const e = explainExportError(Object.assign(new Error("File not found."), { code: 404 }), fileOnly);
  assert.match(e.message, /only drive\.file access.*node auth\.js work --with-drive-readonly/);
  const whole = { alias: "work", scopes: [`${G}drive.file`, `${G}drive.readonly`] };
  assert.equal(explainExportError(Object.assign(new Error("x"), { code: 404 }), whole).message, "x");
  assert.equal(explainExportError(Object.assign(new Error("y"), { code: 500 }), fileOnly).message, "y");
});

test("export_presentation's files folder comes from GWORKSPACE_MCP_FILES_DIR and confines writes", async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gws-files-")));
  process.env.GWORKSPACE_MCP_FILES_DIR = dir;
  const { FILES_DIR, resolveWritablePath } = await import("../src/files.js");
  assert.equal(FILES_DIR, dir);
  assert.equal(resolveWritablePath("deck.pdf"), path.join(dir, "deck.pdf"));
  assert.throws(() => resolveWritablePath("../deck.pdf"), /outside the allowed files folder/);
});
