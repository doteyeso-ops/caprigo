# Optional Integrations

## Skills (copy into `skills/`)

These load as Caprigo user skills. They are **not enabled by default**. Copy into `skills/` and restart the gateway:

```bash
# MiroFish (swarm prediction engine)
cp -r integrations/mirofish skills/mirofish
```

## MCP servers (configure your IDE)

These are **not** Caprigo skills. They run as separate MCP processes and are wired in **Cursor**, Claude Desktop, Codex CLI, etc.

| Integration | Purpose |
|-------------|---------|
| [windows-mcp](windows-mcp/README.md) | [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) — Windows UI automation; use Caprigo **Settings → MCP servers** or IDE MCP config. |

See each folder’s `README.md` for install steps.
