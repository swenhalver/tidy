# Tidy local MCP

Tidy's MCP design tools as a local stdio server. Agents in Claude Code, Codex, T3
Code or the Claude desktop app can create, read, edit, validate and export designs in
Tidy desktop projects without a Tidy account, database or web app.

The tools are the web app's own MCP registry and design code, bundled unchanged.
At build time, the web modules that use Postgres, R2 storage, organization
membership or account integrations are replaced by shims in `src/shims/` that read
and write the desktop app's project files:

```text
your-project/.tidy/
  designs/<id>.json   # { id, name, folderId, document }
  folders/<id>.json   # { id, name }
  assets/<id>.json    # { dataUrl }
```

The build fails if any bundled code still imports a database, storage, Workers or
Next.js module. `src/shims/contract.ts` type-checks that each shim accepts every call
the web code makes, so upstream signature changes surface in `typecheck`.

## Build

From the repository root:

```sh
bun install
bun run build:local-mcp
```

This writes `apps/local-mcp/dist/tidy-mcp.js`. Run it with Bun from this checkout:
it loads `zod` from the repository's `node_modules`. Rebuild after pulling changes.

## Connect an agent

Use absolute paths. Replace `/path/to/tidy` with this repository's location.

**Claude Code** (also used by T3 Code's Claude threads):

```sh
claude mcp add --scope user tidy -- ~/.bun/bin/bun /path/to/tidy/apps/local-mcp/dist/tidy-mcp.js
```

**Codex CLI and app** (also used by T3 Code's Codex threads), in `~/.codex/config.toml`:

```toml
[mcp_servers.tidy]
command = "/Users/you/.bun/bin/bun"
args = ["/path/to/tidy/apps/local-mcp/dist/tidy-mcp.js"]
```

**Claude desktop app**, in `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tidy": {
      "command": "/Users/you/.bun/bin/bun",
      "args": ["/path/to/tidy/apps/local-mcp/dist/tidy-mcp.js"]
    }
  }
}
```

## Projects and files

The hosted tools' organizations are local projects here:

- `list_organizations` returns the projects opened in the Tidy desktop app, most
  recent first. It also includes the folder in the `TIDY_PROJECT` environment
  variable, or the server's working directory when it already contains `.tidy/`.
- Any `organization_id` can also be an absolute folder path. The folder becomes a
  Tidy project, with the same `.tidy/` layout the desktop app creates. Root and home
  folders are refused.
- File IDs are design IDs. Designs written by the server appear in the desktop app
  immediately; open canvases reload from disk.

Revisions are derived from each file's content hash. Any change, including edits in
the desktop app, changes the revision, so stale `patch_document` and import commits
are refused instead of overwriting newer work. Writes use a temporary file and an
atomic rename, and refuse symbolic links, like the desktop app.

Imports are staged in memory for up to 24 hours and are lost if the server restarts.

## Differences from the hosted server

- No sign-in, OAuth, quotas or account activity broadcasting.
- GitHub, Linear and the ChatGPT `preview_design` widget are not included.
- `export_visual_preview` downloads catalogued Google Fonts. Nothing else uses the
  network.
- Commit results return the design file path as `url`.

## Test

```sh
bun run --cwd apps/local-mcp test
bun run --cwd apps/local-mcp typecheck
```

Tests build the bundle and drive it over stdio against temporary projects.
