import path from "path";
import os from "os";
import { createFilesFolder } from "google-mcp-accounts";

// The only folder export_presentation may write to. Without this, a
// prompt-injected tool call could overwrite files anywhere. Override with the
// GWORKSPACE_MCP_FILES_DIR environment variable.
export const { FILES_DIR, resolveWritablePath } = createFilesFolder(
  process.env.GWORKSPACE_MCP_FILES_DIR
    ? path.resolve(process.env.GWORKSPACE_MCP_FILES_DIR)
    : path.join(os.homedir(), "Downloads", "gworkspace-mcp")
);
