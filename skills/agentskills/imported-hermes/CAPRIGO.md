# Imported Hermes skills -> Caprigo Core

The bundled `SKILL.md` files in this subtree were written for **Hermes Agent** and imported into Caprigo. Caprigo uses the same instruction-playbook idea: call the tool `as_<skill-name>` to load the markdown into the model context, then follow the workflow using Caprigo's real tools.

## Core Caprigo tools (typical names)

Exact names match your build; common bundled tools include:

- **`execute_command`** - shell (PowerShell/bash). Use `cwd` when the playbook assumes a directory.
- **`read_file`**, **`write_file`**, **`list_directory`**, **`search_files`** - workspace filesystem.
- **`http_request`** - HTTP client (method, url, headers, body). Prefer this over inventing a `fetch` tool.
- **Memory** - `store_memory` / `retrieve_memory` / `list_memory_keys` (Caprigo Core file-backed memory).
- **MCP** - Optional `mcp_*` tools from **Settings -> MCP servers** (stdio MCP).

## Replacing Hermes-only concepts

| Playbook says | In Caprigo |
|---------------|------------|
| `hermes <subcommand>` | Not installed by default. Use shell + public HTTP APIs, or install Hermes CLI yourself if you truly need it. |
| `web_extract(urls=[...])` | `http_request` GET (and parse), or `curl`/`Invoke-WebRequest` via `execute_command`. |
| `~/.hermes/config.yaml` | Caprigo uses env + gateway config; there is no Hermes home dir unless you install Hermes. |
| Webhook subscriptions / gateway | Hermes-specific. For Caprigo-only automation, use your own HTTP server, CI, or MCP - see individual playbooks' Caprigo footers. |
| Apple / iMessage / FindMy | macOS + Apple ecosystem; Caprigo on Windows/Linux cannot drive these without separate bridges. |

## Skills with **Caprigo playbook (extended)**

These playbooks include an extra **Caprigo playbook (extended)** section (not only the standard footer):
`software-development/plan`, `writing-plans`, `subagent-driven-development`, `test-driven-development`, `requesting-code-review`, `systematic-debugging`, `github/auth`, `github/github-issues`, `github/github-pr-workflow`, `github/github-code-review`, `github/github-repo-management`, `github/codebase-inspection`, `mcp/native-mcp`, `devops/webhook-subscriptions`, `research/arxiv`, `research/research-paper-writing`, `research/polymarket`, `research/llm-wiki`, `research/blogwatcher`, `autonomous-ai-agents/hermes-agent`, `autonomous-ai-agents/codex`, `autonomous-ai-agents/opencode`, `autonomous-ai-agents/claude-code`.

## Token limits

Loading **all** `as_*` tools at once can overwhelm small models. Use **per-agent assigned skills** in the Agent Builder to select only the playbooks you need for a session.

## Safety

Playbooks may include powerful shell, Git, or network patterns. Review before running on production systems; scope tokens and credentials via env vars, never commit secrets.
