# Caprigo

**Caprigo** is the product: local-first AI agents, fleet UI, and marketplace-connected skills.

The public product home for the beta is **[caprigoai.com](https://caprigoai.com)**.

For the current beta, **[vibes-coded.com](https://vibes-coded.com)** is Caprigo's marketplace home. It is where Caprigo-related AI agent skills are bought, sold, and imported into the runtime. Caprigo also supports a connector path for external agent skill ecosystems so those skills can tie back to the Vibes marketplace.

- **Caprigo Core** — the runtime engine (LLM adapters, skills, sessions, gateway).
- **Caprigo CLI** — command-line client (`caprigo`).
- **Caprigo Mesh** — agent networking (planned; not in this repo yet).

## Quick Start

```bash
npm install
npm run build
npm run build:web    # Build dashboard
npm run start       # Caprigo Core gateway on :18789 (serves API + dashboard)
```

For the recommended beta setup path, see `INSTALL_AND_FIRST_RUN.md`.

Windows quick start:

```powershell
.\setup.ps1
```

or:

```bat
setup.bat
```

If Caprigo is already configured and you just want to start it:

```powershell
.\launch.ps1
```

CLI first-run helpers:

```bash
caprigo onboard
caprigo setup --interactive
caprigo doctor
```

The interactive setup flow can write `.env`, start the gateway, and open the local Overview page for you. `setup.ps1` wraps install, build, and guided setup into one Windows-first entry point, while `launch.ps1` is the lightweight post-setup launcher.

Use `caprigo doctor` to inspect local config, permissions, and live runtime status when troubleshooting a beta install.

Or for development: run `npm run web` in another terminal (Vite on :3000 with hot reload).

Then:

```bash
# Create a session
curl -X POST http://localhost:18789/api/sessions

# Send a message (use the session id from above)
curl -X POST http://localhost:18789/api/sessions/SESSION_ID/messages \
  -H "Content-Type: application/json" \
  -d '{"message": "List files in the current directory"}'
```

Built-in workflow crews in the web UI now include:

- `Repo Crew` - repo scouting plus implementation
- `Automation Crew` - local script execution plus result reporting
- `Launch Audit Crew` - launch-readiness review across setup, UX, and release risk
- `PR Review Crew` - structured review workflow for a local diff, patch, branch, or pull request

Board-level workflow tooling now also includes:

- `Workflow library` - one shared launcher for the built-in crews from Overview and Board
- `Workflow Recipes` - saved local presets for orchestrator launches, including trigger metadata (`manual`, `file-change`, `daily-sweep`) plus optional lead-instruction markdown injected into the launched lead
- Selected-crew strip - shows the current lead, member chips, and direct actions when a crew member is selected on the Board
- Heavy trace badge - warns when a session's recent trace volume or cost heuristic looks high

## Add Your Own Skills

Drop a `.js` file into `./skills/` or `~/.caprigo/skills/`. For **Agent Skills** (`SKILL.md`, [agentskills.io](https://agentskills.io)-compatible layout), use `./skills/agentskills/` (see `skills/agentskills/README.md`).

```javascript
// skills/my-skill/index.js
module.exports = {
  name: 'my_skill',
  description: 'What it does',
  execute: async (params) => {
    return { success: true, result: 'done' };
  },
};
```

Restart the gateway. Your skill is loaded.

Built-in filesystem/context tools now include:

- `read_file`
- `list_directory`
- `search_files`
- `search_replace`
- `repo_map` — compact structural codebase map for symbol-level context without dumping whole files into the prompt
- `codebase_context` — one-shot repo-aware retrieval that combines structural mapping plus text hits, then ranks candidate files before `read_file`

For TypeScript/JavaScript-family files, repo mapping now uses a real TypeScript AST walk for classes, interfaces, types, enums, functions, methods, and function-valued properties. Other languages still use the existing lightweight heuristic path.

## Trace Visibility

Caprigo now exposes a lightweight trace/replay layer for tool activity without adding a separate observability service.

- Session trace entries now include compact `rationale`, `resultSummary`, and `outputChars` fields.
- The web UI derives rough pressure and cost heuristics from recent trace activity, including `light` / `watch` / `heavy` pressure and `low` / `watch` / `high` cost signals.
- Board cards can surface a `Heavy` badge when a session's recent trace looks expensive or noisy.
- Session details can export trace bundles as markdown or JSON for replay and review.

Relevant endpoints:

- `GET /api/execution-log`
- `GET /api/sessions/:id/execution-log`
- `GET /api/sessions/:id/execution-log/export?format=markdown`
- `GET /api/sessions/:id/execution-log/export?format=json`

## Permission hardening

Caprigo now applies a baseline permissions layer inspired by the upstream agent-runtime project we reviewed:

- filesystem tools are scoped to approved paths
- shell execution rejects a blocked-command list
- shell working directories must stay inside approved scopes by default

Caprigo writes the permissions file to:

```text
~/.caprigo/permissions.json
```

Default approved scopes include:

- the Caprigo workspace root
- the Caprigo data root

If a file or shell action is denied, expand the approved scopes in `permissions.json` intentionally instead of disabling the whole safety layer.

## Global LLM Guide

Caprigo now supports a workspace-level guide file that is automatically injected into every **LLM** session before the model starts operating.

- Default file: `CAPRIGO_LLM_GUIDE.md` in the workspace root
- Workspace root: `CAPRIGO_WORKSPACE` if set, otherwise the gateway working directory
- Optional override: `CAPRIGO_LLM_GUIDE_PATH` or `CAPRIGO_PROGRAM_GUIDE_PATH`

Use this file to describe Caprigo itself for connected models: what the product is, how the UI maps to behavior, when to use Board vs Session, runtime modes, orchestration, and any product-specific operating rules you want every model to read first.

Recommended content for this file includes Caprigo's relationship to **vibes-coded.com**, marketplace-imported skills, and any connector-specific rules you want external LLMs to understand before they begin operating the product.

## Caprigo CLI

The command name is **`caprigo`** (see `packages/cli` → `"bin": { "caprigo": ... }`). You do **not** have to type `npm run cli --` unless you prefer a repo shortcut.

**From the repo root** (after `npm install` and `npm run build` so `packages/cli/dist` exists):

- **`npx caprigo`** — runs the `caprigo` binary from the workspace (same as global `caprigo` when linked).
- **`npm run caprigo -- <args>`** — same CLI; `--` forwards flags (e.g. `npm run caprigo -- agents list`).

**On your PATH** (pick one):

- **`cd packages/cli && npm link`** — then type **`caprigo`** from any directory.
- Or **`npm install -g ./packages/cli`** from the repo root — installs the `caprigo` command globally.

Set **`CAPRIGO_GATEWAY_URL`** if the API is not `http://localhost:18789`. If the gateway uses **`CAPRIGO_API_TOKEN`**, export the same token in your shell for mutating CLI calls.

```bash
caprigo                    # overview home panel
caprigo open               # open dashboard in browser
caprigo agents list
caprigo agents create -n "Coder"
caprigo chat <sessionId> -m "Hello"
caprigo skills
caprigo models
caprigo health
caprigo onboard
```

## Optional: MiroFish Integration

[MiroFish](https://github.com/666ghj/MiroFish) is an API-driven swarm intelligence engine. To enable:

```bash
cp -r integrations/mirofish skills/mirofish
```

Requires MiroFish backend on port 5001. Set `MIROFISH_URL` to override.

## Optional: MCP servers (e.g. Windows-MCP)

Caprigo Core includes an **MCP client**: the gateway can spawn stdio MCP servers and expose each tool as `mcp_<id>_<tool>` alongside normal skills. Configure under **Settings → MCP servers** in the web UI (writes `gateway/mcp-servers.json` under your Caprigo data directory), or use `GET`/`PATCH /api/mcp-servers`.

For [Windows-MCP](https://github.com/CursorTouch/Windows-MCP) specifically, see [integrations/windows-mcp/README.md](integrations/windows-mcp/README.md). You can also attach Windows-MCP only to **Cursor** or another IDE via [mcp-config.example.json](integrations/windows-mcp/mcp-config.example.json) if you do not need it in Caprigo chat.

Env: `CAPRIGO_DISABLE_MCP=1` disables MCP; `CAPRIGO_MCP_TOOL_TIMEOUT_MS` sets per-tool timeout (default 180000 ms).

## Requirements

- Node.js 18+
- [Ollama](https://ollama.ai) installed and running
- A local Ollama model, for example: `ollama pull qwen3.5:latest`

### Ollama GPU (CPU-heavy inference, idle GPU)

Caprigo only **calls** Ollama over HTTP; **GPU vs CPU is decided on the Ollama host** (drivers, build, model size, VRAM).

1. **Verify the server actually uses the GPU:** During a request, watch **NVIDIA:** `nvidia-smi`; **AMD (Linux):** `rocm-smi` / `radeontop` if available. Flat VRAM + busy CPU usually means CPU inference.
2. **Common causes:** Ollama installed as **CPU-only**; **Docker** without GPU passthrough; **model + KV cache** larger than VRAM so most weights run on CPU; very large **`num_ctx`** in Settings eating VRAM.
3. **Fix on the Ollama side:** Install a **GPU-enabled** Ollama build and the right **NVIDIA** or **AMD ROCm** stack for your OS. Use a **quantized** model that fits in VRAM or a smaller tag. Lower context (**Settings →** engine / per-agent). See [Ollama GPU](https://docs.ollama.com/gpu) and the upstream repo for your OS.

#### AMD RX 580 (8 GB) and similar Polaris cards

**Ollama’s official AMD path is ROCm on Linux**, and **many builds target newer RDNA cards**. **Polaris (RX 580 / 570 / etc.) is often not in the supported set**, so Ollama may **fall back to CPU** even though the GPU shows idle — which matches “CPU heavy, GPU ~1%.” That is usually a **hardware/software support** issue on the Ollama host, not something Caprigo can fix over HTTP.

**Realistic options:**

- **Confirm** with `ollama ps` / server logs whether layers are on GPU or CPU.
- **Linux + ROCm:** Some users experiment with overrides (e.g. `HSA_OVERRIDE_GFX_VERSION`); results vary and can be unstable — search for your distro + “Ollama RX 580”.
- **Experimental Vulkan:** Ollama can enable extra GPU coverage via Vulkan (`OLLAMA_VULKAN=1` on the **Ollama server** — see [Ollama GPU](https://docs.ollama.com/gpu) / FAQ). Worth a try on Windows or Linux if ROCm does not list your card; still experimental.
- **Optimize CPU path:** Fewer threads competing with the system, **smaller / Q4 models**, **lower `num_ctx`**, and `CAPRIGO_OLLAMA_NUM_THREAD` to tune CPU threads.
- **Hardware path with fewer headaches:** A **supported AMD (e.g. RX 6000/7000)** or **NVIDIA** card that Ollama documents for your OS, if you need reliable GPU offload.

4. **From Caprigo’s gateway (optional):** Set **`CAPRIGO_OLLAMA_NUM_GPU`** so requests include Ollama’s **`num_gpu`** (number of **layers** offloaded — not “GPU index”). Example: try **`99`** or **`-1`** if your Ollama version accepts “max layers” (check server logs / `ollama ps`). **`CAPRIGO_OLLAMA_NUM_THREAD`** sets CPU thread count for layers that stay on CPU. This only helps if the **Ollama host** already has a working GPU backend; it does not add ROCm support for an unsupported card.

## Environment

Use **`CAPRIGO_*`** variables. The runtime also reads older single-product env names via `caprigoEnv()` in `@caprigo/shared` so existing installs keep working.

- `PORT` — Gateway port (default: 18789)
- `OLLAMA_URL` or `CAPRIGO_OLLAMA_URL` — Ollama API URL (default: http://localhost:11434). For Ollama on another machine, e.g. `http://172.29.176.1:11434` (that host must serve Ollama on `0.0.0.0:11434` or your LAN IP, not only `127.0.0.1`). See `.env.example`.
- `CAPRIGO_OLLAMA_TIMEOUT_MS` — Per **`/api/chat`** call from the gateway (default **600000** ms). Each tool round is a separate call; raise this on slow CPU/GPU if chats abort mid-run.
- `CAPRIGO_OPENAI_CHAT_TIMEOUT_MS` — Same idea for OpenAI-compatible chat (default **600000** ms).
- `CAPRIGO_OLLAMA_NUM_GPU` / `CAPRIGO_OLLAMA_NUM_THREAD` — Optional; forwarded into Ollama chat **`options`** (GPU layer offload + CPU threads). See *Ollama GPU* above.
- `CAPRIGO_LLM_PROVIDER` — `ollama` (default) or OpenAI-compatible
- `CAPRIGO_PROGRAM_GUIDE_MAX_CHARS` — Max chars injected from `CAPRIGO_LLM_GUIDE.md` or the configured global guide path (default **16000**).
- `CAPRIGO_AGENT_INSTRUCTIONS_MAX_CHARS` — Max chars injected from per-session markdown instruction files (default **24000**).
- `CAPRIGO_INLINE_INSTRUCTIONS_MAX_CHARS` — Max chars injected from inline session markdown instructions (default **12000**).
- `CAPRIGO_HISTORY_RECENT_MESSAGES` — Number of recent user/assistant turns kept verbatim in prompt history before older turns are compressed into a digest (default **12**).
- `CAPRIGO_HISTORY_SUMMARY_MAX_CHARS` — Max chars used for the compressed “earlier conversation digest” block (default **6000**).
- `CAPRIGO_TOOL_RESULT_MAX_CHARS` — Max chars of any tool result fed back into the next model step (default **4000**).
- `CAPRIGO_SKILLS_DIR` — Override skills directory
- `CAPRIGO_HOME` — Data directory root (default: `~/.caprigo`, with migration if an older dot-directory exists)
- `DEFAULT_MODEL` — Model name
- `MIROFISH_URL` — MiroFish backend URL (default: http://localhost:5001)
