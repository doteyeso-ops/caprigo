# Windows-MCP (optional)

[Windows-MCP](https://github.com/CursorTouch/Windows-MCP) is an **MIT-licensed MCP server** that exposes Windows desktop automation: UI automation, screenshots, shell, clipboard, apps, and more.

## Option A — Caprigo Core (in-process MCP client)

Caprigo runs an MCP **client** in the gateway. Add a stdio server under **Settings → MCP servers** (or edit `gateway/mcp-servers.json` under your Caprigo data root). Each MCP tool is registered as `mcp_<serverId>_<ToolName>`.

Example payload (same shape as `PATCH /api/mcp-servers`): see [`caprigo-mcp-servers.example.json`](./caprigo-mcp-servers.example.json).

- Env: `CAPRIGO_DISABLE_MCP=1` skips MCP startup; `CAPRIGO_MCP_TOOL_TIMEOUT_MS` (default 180000) caps each tool call.

## Option B — IDE only (Cursor, Claude Desktop, …)

Configure the MCP server in your editor so **that** client talks to `uvx windows-mcp`. Caprigo skills are unchanged; use this when you only want desktop automation from the IDE, not from Caprigo chat.

Caprigo Core already provides filesystem, shell, HTTP, and marketplace skills. **Windows-MCP adds OS-level UI automation** when you need it.

## Prerequisites

- **Windows** 10/11 (or supported Windows release per upstream)
- **Python 3.13+** and [**uv**](https://docs.astral.sh/uv/) (recommended), or install the package per [upstream README](https://github.com/CursorTouch/Windows-MCP#%EF%B8%8Finstallation)

## Quick install (PyPI)

Upstream recommends:

```bash
uvx windows-mcp
```

First run may take a minute while dependencies install.

## Cursor / MCP client configuration

Add a server that runs `uvx` with argument `windows-mcp` (or use the full path to `uvx.exe` / `uv.exe` if your app does not inherit `PATH` — see upstream docs for Claude Desktop MSIX and similar).

Example shape (Claude Desktop–style JSON; many MCP clients use the same `mcpServers` structure):

See [`mcp-config.example.json`](./mcp-config.example.json) in this folder.

In **Cursor**, open MCP settings and register a new server using that command and args, or paste the JSON if your version supports file-based config. If tools do not appear, check the MCP log and use absolute paths to `uvx` as in the [Windows-MCP README](https://github.com/CursorTouch/Windows-MCP).

## Security

Windows-MCP has broad system access. Read [their security policy](https://github.com/CursorTouch/Windows-MCP/blob/main/SECURITY.md) before enabling. Disable telemetry in `env` if you prefer (`ANONYMIZED_TELEMETRY`: `false`).

## Remote / VM mode

Optional cloud VM flow uses `MODE=remote`, `SANDBOX_ID`, and `API_KEY` — see upstream **Remote Mode** section.
