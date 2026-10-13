# Test Tidy MCP connections

The [MCP Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector)
is a browser client for Tidy's `/api/mcp` endpoint. It exercises discovery,
OAuth, tool schemas and calls. It does not run Claude Code, OpenCode or Pi,
or capture those clients' traffic. Verify each client separately against the
same endpoint after testing with Inspector.

## Start the web Inspector

Requirements: Node 22.19.0 or newer and `bun install --frozen-lockfile`.
Inspector is pinned as a development dependency and is not part of the deployed
application.

```sh
# Local Tidy, running in a separate terminal with bun dev:
bun run mcp:inspector:local

# Your explicitly chosen hosted Tidy endpoint:
bun run mcp:inspector --transport http --server-url https://your-tidy-host.example/api/mcp

# An existing client configuration, opened read-only:
bun run mcp:inspector --config /absolute/path/to/mcp.json
```

The local preset uses `http://localhost:3000/api/mcp`. This must match the
app's `BETTER_AUTH_URL` origin; `localhost` and `127.0.0.1` are distinct OAuth
resource identifiers. For another port or hostname, use `--server-url` instead.

Inspector binds to loopback by default and opens the printed token-bearing URL
at `http://127.0.0.1:6274`. Keep its terminal running. Use
`MCP_AUTO_OPEN_ENABLED=false` to open that URL manually, or `CLIENT_PORT=6277`
if the UI port is occupied. Stop it with Ctrl+C. Keep token authentication
enabled and the Inspector local; it can launch processes on your machine.

`--config` leaves the checked-in preset unchanged. Run `bun run mcp:inspector`
without flags for Inspector's editable personal catalog. OAuth credentials
are managed by Inspector outside this repository, using the OS keychain when
available. See its [storage documentation](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/security).
Do not commit client secrets, bearer tokens or exported protocol traces.

## Check the connection

1. Select the server and connect. Follow the browser OAuth flow and choose the
   intended Tidy account and organizations on the consent screen. Inspector
   has its own authorization; signing in with a coding agent does not sign
   Inspector in.
2. Open Tools and list the available tools. Call `list_organizations` with `{}`,
   then `list_files` with `{"organization_id":"<an ID from the result>"}`.
   These read design data without editing files.
3. Inspect Protocol for JSON-RPC errors and Network for HTTP status codes,
   discovery responses and OAuth challenges. An initial `401` should lead to
   sign-in. Repeated `401` responses after sign-in indicate an authorization
   problem; a transport connection alone is not a successful tool check.
4. Test design edits only in a disposable test file when you intend to make
   changes. Reads require `mcp:read`; edits also require `mcp:write`. Inspector
   supports additional-scope authorization when a tool requires more access.
   Request `offline_access` when checking refresh-token behavior.

The preset selects the legacy protocol era for comparison with existing
clients. To test the 2026-07-28 protocol explicitly, launch the hosted endpoint
with `--protocol-era modern`; use `auto` to negotiate. Record the era and client
version when comparing failures. A modern-only failure does not establish that
the legacy clients are broken.

## Check real coding clients

Replace the example URL below with the exact endpoint tested in Inspector.
Each client owns its configuration and OAuth tokens. These examples are
instructions, not automatic changes to your installed clients.

### Claude Code

```sh
claude mcp add --transport http --scope local tidy-test https://your-tidy-host.example/api/mcp
claude mcp list
```

Open `/mcp` inside Claude Code and complete sign-in for `tidy-test`. Ask it to
list your Tidy organizations and files without making changes. See
[Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp).

### OpenCode

Merge this entry into your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "tidy-test": {
      "type": "remote",
      "url": "https://your-tidy-host.example/api/mcp",
      "enabled": true,
      "oauth": {
        "scope": "mcp:read mcp:write offline_access"
      }
    }
  }
}
```

```sh
opencode mcp auth tidy-test
opencode mcp list
opencode mcp debug tidy-test
```

Use only `mcp:read` for a read-only grant. Explicit scopes let you test write
authorization in clients that do not automatically request more scopes after
a read-only connection. See [OpenCode's MCP documentation](https://opencode.ai/docs/mcp-servers/).

### Pi

Pi's core [does not include an MCP client](https://github.com/earendil-works/pi/tree/main/packages/coding-agent#philosophy).
There is no built-in `pi mcp add` or `pi mcp login` workflow. For native MCP
tools in Pi, use an MCP extension that supports Streamable HTTP and OAuth,
following that extension's configuration and sign-in instructions.

For testing from Pi's shell tool without installing an extension, complete
OAuth in the web Inspector first, then run the same pinned Inspector in CLI
mode from the repository root:

```sh
bunx --no-install mcp-inspector --cli --transport http \
  --server-url https://your-tidy-host.example/api/mcp \
  --stored-auth-only --method tools/list

bunx --no-install mcp-inspector --cli --transport http \
  --server-url https://your-tidy-host.example/api/mcp \
  --stored-auth-only --method tools/call --tool-name list_organizations
```

This checks Tidy through Inspector using Pi as the command runner; it does not
verify a Pi MCP extension. `--stored-auth-only` fails without a stored grant
instead of opening a login flow that the agent cannot complete. Use the exact
same endpoint URL and OS account as the web Inspector.
