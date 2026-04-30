# Caprigo — Continuity

## Product map

| Name | What it is |
|------|----------------|
| **Caprigo** | Main product (UX, positioning, this repo as a whole). |
| **Caprigo Core** | Runtime engine: LLM backends, skills, sessions, gateway (`@caprigo/*` packages). |
| **Caprigo CLI** | `caprigo` command. |
| **Caprigo Mesh** | Agent networking / federation — **future**, not implemented here yet. |

## Overview

Caprigo is a **local-first agent platform**: you add skills, **Caprigo Core** runs them. Think “game engine for agents.”

## Key Differentiators

1. **Pluggable LLM** — `CAPRIGO_LLM_PROVIDER`: `ollama` (default) uses local Ollama `/api/chat`. `openai` uses **OpenAI-compatible** `POST …/v1/chat/completions`. Skills use the same JSON tool schema for both.

2. **Native tool calling** — Skills are exposed as `tools`. Models that support function calling use structured `tool_calls`; if the runtime rejects tools, the engine falls back once to **text `TOOL:` / `PARAMS:`** (`CAPRIGO_LEGACY_TOOLS_ONLY=true` to skip native tools entirely).

3. **User skills loader** — Skills load from:
   - `CAPRIGO_SKILLS_DIR` env var (see `caprigoEnv()` for migration)
   - A `skills/` directory found by **walking up from `process.cwd()`**, else `<caprigoDataRoot>/skills` (default `~/.caprigo/skills`, with migration from older layouts)
   - `GET /api/skills` re-scans that directory so new files appear after **Refresh** without restarting the gateway
   - **`skills/agentskills/imported-hermes/`** — imported [Nous Hermes Agent](https://github.com/NousResearch/hermes-agent) skill tree (MIT), with per-file **Caprigo Core (adaptation)** footers; **24** skills also have **Caprigo playbook (extended)** sections (listed in **`imported-hermes/CAPRIGO.md`**); optional `npm run imported-hermes:footers` to re-apply footers after upstream edits (`npm run hermes:footers` kept as alias)

4. **Vibes-Coded integration** — Core skills include REST tools aligned with [vibes-coded.com](https://vibes-coded.com). Local markdown packs via `CAPRIGO_VIBES_PACKS_DIR` + `vibes_read_local_pack`.

5. **Persistent memory** — `store_memory` / `retrieve_memory` / `list_memory_keys` use `<caprigoDataRoot>/memory.json` (`CAPRIGO_HOME` override).

6. **Execution logging** — Each skill run appends one JSON line under `<caprigoDataRoot>/executions.jsonl` (disable with `CAPRIGO_EXECUTION_LOG=0`, or path override). Gateway: `GET /api/execution-log?limit=100`.

6b. **Offline scripts (no LLM)** — Files under `offline-scripts/` or `CAPRIGO_OFFLINE_SCRIPTS_DIR` / `<caprigoDataRoot>/offline-scripts`. `POST /api/sessions/:id/offline/run` `{ scriptId, args? }` spawns the process. Timeout: `CAPRIGO_OFFLINE_SCRIPT_TIMEOUT_MS` (default 10m).

7. **Vibes-Coded depth** — Beyond browse/manifest/install/delivery: `import-preview` / `import-action` (public + agent), `proof_of_use`, `affiliate_link`, `commerce_summary`. Optional skill metadata: `executionType`, `vibesListingId`. See Vibes-Coded docs for API parity notes.

8. **Core tools (filesystem, web, host)** — Filesystem: `read_file` / `write_file` / `list_directory`, **`search_files`**, **`search_replace`** (Hermes / OpenClaw-style). **Web:** **`web_search`** (DuckDuckGo instant JSON, no API key), **`web_fetch`** (https GET → plain text / JSON), plus **`http_get`** / **`http_post`** (browser-like `User-Agent`, response size cap via `CAPRIGO_HTTP_MAX_BODY_BYTES`). **Host:** **`execute_command`** (shell on gateway host; optional `timeout_ms` up to 5m), **`system_info`** (OS, memory, paths). Opt out: **`CAPRIGO_DISABLE_WEB_TOOLS`**, **`CAPRIGO_DISABLE_EXECUTE_COMMAND`**. JS-rendered pages and true headless browsing are not built in — use **MCP** or user skills if needed.

9. **Web dashboard** — **Dashboard** tab: hero strip (agent/tool counts, LLM status, workspace path, primary **Create agent**), **Runtime setup** sidebar, **Agent fleet** grid. **Workspace** tab layout and behavior unchanged.

10. **Caprigo CLI** — `caprigo` with **no args** prints an overview panel (gateway URL, workspace, LLM/model, tool/session counts, command hints). Subcommands mirror the dashboard: **`open`** (browser), **`agents list|create|show|delete`**, **`chat`**, **`skills`**, **`models`**, **`health`**, **`onboard`**. Uses **`CAPRIGO_GATEWAY_URL`** and the same **`CAPRIGO_API_TOKEN`** header as other clients. Implementation: `packages/cli/src` (`style.ts` ANSI panels, `gateway-client.ts` fetch + auth).

### Roadmap doc vs Caprigo Core (quick map)

| Tier 1 theme | In Caprigo Core now |
|--------------|----------------|
| Skill execution | Yes — core + user skills + Vibes HTTP tools |
| Standardized schema | Partial — `toolParameters` + optional `executionType` / `vibesListingId` |
| Agent loop | Chat loop + tools (not 24/7 daemon; use external scheduler if needed) |
| Execution logging | Yes — JSONL + API |
| Agent builder UI | Yes — web **Agent Builder** + **Assign skills** (core / user / Vibes marketplace imports) |

| Tier 2+ (marketplace UX, chaining, auto-purchase, dashboards) | Mostly on **vibes-coded.com**; Caprigo web has a **fleet dashboard** + **Agent Builder** (sessions, skills, Vibes marketplace install) |

## Project Structure

```
Agent/
├── packages/
│   ├── shared/          # Types, caprigoEnv, `openAICompatibleRequestHeaders` (UA for CDNs)
│   ├── ollama-client/   # Ollama /api/chat
│   ├── chat-backend/    # Ollama + OpenAI-compatible adapters
│   ├── user-skills-loader/
│   ├── agent/           # Core + vibes + tool-schema
│   ├── gateway/         # HTTP API
│   ├── web/             # Vite UI; `data/openaiCompatibleBaseExamples.ts` — suggested OPENAI_BASE_URL list
│   └── cli/             # caprigo — dashboard (default), agents, chat, skills, models, open, health, onboard
├── skills/              # User skills: helpers, probes, Caprigo introspection (env, data dir, GET /api/*)
└── package.json
```

## Environment (common)

Document **`CAPRIGO_*`**. Older installs: the same values are merged via `caprigoEnv()` in `packages/shared/src/caprigo-env.ts`.

| Variable | Purpose |
|----------|---------|
| `CAPRIGO_LLM_PROVIDER` | `ollama` (default) or `openai` / `openai_compatible` / `api` |
| `CAPRIGO_LLM_CONFIG_SECRET` | Optional secret used to encrypt persisted LLM connection config at rest (recommended for stronger key derivation). |
| `CAPRIGO_API_TOKEN` | Optional gateway API token. When set, mutating `/api/*` routes require `x-caprigo-token` or `Authorization: Bearer`. |
| `CAPRIGO_BIND_HOST` | Optional gateway bind host (default `127.0.0.1` for safer local-only posture). |
| `CAPRIGO_OLLAMA_TIMEOUT_MS` | Optional timeout for each Ollama `/api/chat` call (default **600000** ms; each tool round uses a separate call). |
| `CAPRIGO_OLLAMA_NUM_GPU` | Optional. Passed to Ollama `/api/chat` **`options.num_gpu`** (layer offload count; Ollama naming). Use when the **server** under-uses GPU; see README *Ollama GPU*. **Does not** add GPU support on the host — e.g. **AMD Polaris (RX 580)** is often CPU-only with Ollama; see README *AMD RX 580*. |
| `CAPRIGO_OLLAMA_NUM_THREAD` | Optional. Passed to **`options.num_thread`** (CPU threads for non-GPU layers). |
| `CAPRIGO_REQUEST_LOG` | Structured request logging toggle (`1` default, set `0` to disable). |
| `CAPRIGO_RATE_LIMIT_WINDOW_MS` | In-memory API rate-limit window size (default 60000ms). |
| `CAPRIGO_RATE_LIMIT_MAX` | Max requests per IP+method+path per window (default 240). |
| `OLLAMA_URL` / `CAPRIGO_OLLAMA_URL` | Ollama API base (default `http://localhost:11434`). If **either** is set in `.env`, it **overrides** persisted Settings for the Ollama URL on gateway startup (useful for a remote/LAN Ollama host). |
| `OPENAI_BASE_URL` / `OPENAI_API_BASE` | e.g. `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, `https://api.groq.com/openai/v1`, `https://api.together.xyz/v1`, local `http://127.0.0.1:1234/v1` |
| `OPENAI_API_KEY` / `CAPRIGO_OPENAI_API_KEY` | Bearer token for remote API |
| `CAPRIGO_OPENAI_USER_AGENT` | Optional. Override `User-Agent` on outbound OpenAI-compatible requests (health, models list, chat). Some CDNs block Node’s default UA. |
| `CAPRIGO_OPENAI_HEALTH_TIMEOUT_MS` | Optional. Health probe timeout for `GET /v1/models` (default 40000, max 120000). |
| `CAPRIGO_OPENAI_CHAT_TIMEOUT_MS` | Optional. `POST /v1/chat/completions` timeout (default **600000** ms). |
| `CAPRIGO_OPENAI_OMIT_MAX_TOKENS` | Optional. `1` / `true` to omit `max_tokens` in chat body (picky providers). |
| `DEFAULT_MODEL` | Ollama tag or remote model id |
| `CAPRIGO_LEGACY_TOOLS_ONLY` | `true` to force text-only tool protocol |
| `VIBES_CODED_API_BASE` | Default `https://vibes-coded.com/api` |
| `VIBES_CODED_API_KEY` / `CAPRIGO_VIBES_API_KEY` | Agent endpoints |
| `CAPRIGO_VIBES_PACKS_DIR` | Directory of `.md` deliverables for `vibes_read_local_pack` |
| `CAPRIGO_DISABLE_VIBES_INSTALL` | Disables `POST /api/vibes/install` |
| `CAPRIGO_EXECUTION_LOG` | `0` / `false` to disable skill execution log |
| `CAPRIGO_EXECUTION_LOG_PATH` | Override path for JSONL log |
| `CAPRIGO_OFFLINE_SCRIPTS_DIR` | Offline scripts root |
| `CAPRIGO_OFFLINE_SCRIPT_TIMEOUT_MS` | Kill spawn after this (default 600000) |
| `CAPRIGO_HOME` | Override data directory root |
| `CAPRIGO_GATEWAY_URL` | CLI default gateway URL |
| `CAPRIGO_WORKSPACE` | Directory used to resolve each agent’s **`agentInstructionsPath`** (relative `.md` file merged into that agent’s LLM system prompt). Default: gateway `process.cwd()`. |
| `CAPRIGO_DISABLE_WEB_TOOLS` | `1` / `true` — disables **`web_search`** and **`web_fetch`** only (`http_get` / `http_post` unchanged). |
| `CAPRIGO_DISABLE_EXECUTE_COMMAND` | `1` / `true` — disables **`execute_command`**. |
| `CAPRIGO_HTTP_MAX_BODY_BYTES` | Max characters stored from **`http_get`** / **`http_post`** bodies (default **2000000**; capped at 20M). |

## OpenAI-compatible remotes (g4f, OpenRouter, Gemini proxy, etc.)

- **Outbound HTTP:** `@caprigo/shared` provides `openAICompatibleRequestHeaders()` — sets `Accept`, a **browser-like `User-Agent`** (many CDNs block Node’s default), and optional `Authorization: Bearer …`. Override UA with `CAPRIGO_OPENAI_USER_AGENT`. Chat (`openai-backend.ts`), health, and `GET /api/openai/models` all use this.
- **Health:** Non-Ollama providers probe **`GET {OPENAI_BASE}/v1/models`** (or `…/models` if base ends with `/v1`). “Reachable” = 2xx, or **401 / 403 / 429** (host answered). `/health` includes **`openai_probe_http_status`** and **`openai_probe_detail`** when the probe fails; **`openai_base`** is set for any non-Ollama backend. Top bar **API · check** + Runtime setup surface this.
- **UI:** Dashboard **Runtime setup** and **Settings → Connection** list **example** `OPENAI_BASE_URL` values (`OpenAiBaseExamplesList` — OpenAI, OpenRouter, Groq, Together, Mistral, LM Studio). In Settings, provider/base/key can be updated live via `PATCH /api/llm-config`.
- **Chat errors:** HTTP errors prefer JSON **`error.message`** (and code) in thrown text. Gateway **`POST /api/sessions/:id/messages`** adds hints only for **Ollama down**, **OpenAI connectivity / 401 / 403** (check env), or **402 / balance / PAYMENT_REQUIRED** (credits or cheaper model) — not a blanket “fix OPENAI_BASE_URL” on every API failure.
- **Hosted economics:** Providers (e.g. g4f “pollen”) may return **402** if the model costs more than account balance; fix is **top-up**, **cheaper model**, or **local Ollama** — not Caprigo wiring.

## Web UI — tabs: Dashboard · Workspace · Chat · Settings

- **Dashboard:** Two columns — **Runtime setup** (engine snapshot, LLM probe detail for remotes, example API bases) + **Agent fleet** (launch agents, cards, activity). No chat column.
- **Workspace:** Open canvas: **Add agent**; draggable cards. Each card has **LLM** vs **Local (offline)** — `Session.runtimeMode` is `llm` (server model on Chat) or `offline` (no chat LLM; disk scripts only). Script dropdown + **Run** per card (`GET /api/offline-scripts`, `POST /api/sessions/:id/offline/run`). **Right‑click** → **Details** / **Assign skills** (hidden when offline) / **Chain to…** (layout only; `localStorage` `caprigo.openWorkspace.v1` with one-time migration from older keys).
- **Per-session skills:** `Session.assignedSkills` whitelists chat tool names (empty = all). Web: **Assign skills** from dashboard or workspace (LLM agents only). `PATCH /api/sessions/:id` with `{ assignedSkills }`; `GET /api/sessions` includes `assignedSkills` (`null` when unrestricted).
- **Per-agent instruction file:** `Session.agentInstructionsPath` — optional path to a markdown file **relative to `CAPRIGO_WORKSPACE`** (default cwd). Contents are read from disk and injected into the **system prompt** for LLM chat (not used for offline-only agents). `GET /api/runtime` exposes **`workspaceRoot`** for the UI. Create/edit in **Agent Builder**; `PATCH` accepts `agentInstructionsPath: null` to clear.
- **Per-agent inline task markdown:** `Session.agentInstructionsMarkdown` — optional string merged into the system prompt after file-based instructions. Edited from **Agent details → Task & instructions** (Workspace context menu **Task & instructions…** scrolls to this panel). `PATCH` with `null` clears.
- **Troubleshooting saves:** If `PATCH /api/sessions/:id` returns 400 and lists `agentInstructionsPath` / `agentInstructionsMarkdown` as “unrecognized” despite valid JSON, the running gateway is older than the repo — run `npm run build` (or `npm run build -w @caprigo/gateway`) and restart `node packages/gateway/dist/index.js`. Gateway applies these fields when the keys are present in the JSON body (including explicit `null`).
- **Stop turn:** `POST /api/sessions/:id/stop` requests best-effort cancellation between tool iterations (`Agent.requestTurnCancel`). Workspace cards expose **■ Stop** when status is `thinking`.
- **Per-session runtime:** `PATCH /api/sessions/:id` `{ runtimeMode: 'llm' | 'offline' }`; `POST /api/sessions` may set `runtimeMode` on create. `GET /api/sessions` includes `runtimeMode`. Chat `POST .../messages` returns **400** if `offline`.
- **Chat:** LLM + tools for agents in **LLM** mode; **Local** mode disables compose (switch on Workspace). Transcript includes **Local** script lines (`role: offline` in API).
- **Settings:** Live engine fields + **Optimization** presets (light / balanced / high / custom) mapping `maxTokens` + Ollama `num_ctx` without jargon; connection is editable (provider, Ollama URL, OpenAI-compatible base, key update).
- **Laptop-first UX:** Settings now includes **Laptop Mode** toggle. When enabled, runtime caps tool-iterations and token/context sizes for lower-power machines and injects environment context (OS/arch/provider/cwd/laptop-mode) into the system prompt for environment-aware behavior.
- **Prompt baseline:** Gateway default system prompt now prefaces identity/mission as a laptop-first autonomous runtime assistant, with explicit tool-first behavior, short-step execution guidance, and anti-hallucination constraints.
- **API:** `GET /api/runtime` (safe engine snapshot incl. `hostPlatform`, `mcp` status, `systemPrompt`, `optimizationProfile`, `ollamaNumCtx`, and live `llmConnection`), `PATCH /api/config` — live engine updates: `name`, `model`, `temperature`, `maxTokens`, `systemPrompt`, `optimizationProfile`, `ollamaNumCtx` (partial OK), and `PATCH /api/llm-config` for provider/base/key/ollamaUrl updates with hot backend swap. `GET /api/system-monitor` — host + gateway process stats for the dashboard widget; user skill `system_monitor` returns the same snapshot for tool calls.
- **LLM credential persistence:** Gateway stores LLM connection state from `PATCH /api/llm-config` in encrypted form at `<caprigoDataRoot>/gateway/llm-config.enc.json` and reloads it on startup. Encryption uses AES-256-GCM with scrypt-derived key material; set `CAPRIGO_LLM_CONFIG_SECRET` for strongest protection.
- **Security hardening:** Mutating gateway APIs are now protected by localhost-only restriction by default; set `CAPRIGO_API_TOKEN` to allow authenticated remote mutation. Gateway bind default is `127.0.0.1`.
- **Traffic controls:** Gateway now applies in-memory API rate limiting per `ip+method+path` and returns `429` with `Retry-After` when exceeded.
- **Observability:** Gateway emits structured JSON request logs (timestamp, request id, method, path, status, latency, ip) and sets `x-request-id` on responses.
- **Reliability hardening:** `/api/llm-config` updates are transactional (validate first, then apply/persist), Ollama client calls now use timeouts, offline script timeout uses stronger termination (Windows process-tree kill / POSIX SIGTERM then SIGKILL), tool execution failures are returned as structured tool errors instead of crashing turns, and empty assistant turns now return a fallback message.
- **State consistency hardening:** Web chat/message race windows are guarded against stale async writes, workspace chain edges derive from backend linkage (`linkedOrchestratorId`), offline run button semantics now match runtime guard, and user-skill disk refresh reconciles removals (deleted local skills are unregistered).
- **Persistence durability:** Memory store and encrypted LLM config writes now use temp-file + rename atomic writes; execution-log tail reader now reads from file end instead of loading full log.
- **Tests:** Added minimal gateway regression tests (`packages/gateway/test/gateway.test.mjs`) covering mutation auth requirement and transactional `/api/llm-config` behavior. Run with `npm run test:gateway` from repo root.
- **Sessions:** `POST /api/sessions` accepts `displayName`, `runtimeMode`, `description`, `objective`, `assignedSkills`, `agentRole`, `linkedOrchestratorId`, `primaryOfflineScriptId`, `assignedOfflineScripts` (all optional except validation rules). `GET /api/sessions` / activity include `description`, `objective`, `primaryOfflineScriptId`, `assignedOfflineScripts`, `runtimeMode`, etc. `PATCH /api/sessions/:id` updates the same fields. Web: **Agent Builder** modal (Create / Edit) and enhanced **Agent details** quick actions (Chat, Workspace, skills, edit).
- **Skills API:** `GET /api/skills` returns `{ skills, skillsDir, localSkillsDbFile }`. Sources include **`agentskill`** for `skills/agentskills/**/SKILL.md` (agentskills.io / Hermes-style instruction playbooks; tools `as_*`). User skills snapshot: `<skillsDir>/.caprigo-skills-db.json`. `POST /api/user-skills` — disable with `CAPRIGO_DISABLE_SKILL_UPLOAD`. **Vibes marketplace:** `GET /api/vibes/listings`, `POST /api/vibes/install` — writes `.vibes-source.json` sidecar. JSON body limit 512kb for user-skills.
- **Per-session LLM model:** `Session.model` optional; chat uses it when set, else engine `PATCH /api/config` model. `GET /api/sessions` includes `model` (override or `null`) and `effectiveModel` (resolved). `POST` / `PATCH /api/sessions` accept `model` (string or `null` to clear). **Ollama installed tags:** `GET /api/ollama/models` → `{ models, defaultModel, ollamaUrl }` from `OLLAMA_URL/api/tags` (empty when provider ≠ ollama). **OpenAI-compatible catalog:** `GET /api/openai/models` → `{ models, defaultModel, baseUrl }` from `OPENAI_BASE_URL` + `GET /v1/models` with Bearer key (empty when provider is not `openai` / `openai_compatible`). Web: Settings + per-agent model pickers use datalist/dropdown + refresh for **Ollama** and **`openai_compatible`**; plain `openai` also fills the list via `/api/openai/models`. Other remote setups: text field.
- **Web dev proxy:** Vite forwards `Content-Type` / `Content-Length` on proxied `POST`/`PATCH` to the gateway so session `PATCH` bodies (e.g. `runtimeMode`) are not dropped.
- **Offline scripts:** `GET /api/offline-scripts`, `POST /api/sessions/:id/offline/run` `{ scriptId, args? }`.
- **Fleet / orchestration:** `Session.agentRole` is **`agent`** (task worker, default) or **`orchestrator`** (coordinates chained sessions only). Legacy `standard` is normalized to `agent`. Task agents set optional `linkedOrchestratorId` to an orchestrator session; the engine validates that target is an orchestrator. **Workspace** “Chain to…” from an orchestrator card sets that link and draws the edge. `fleet_message` from an orchestrator may target only agents where `linkedOrchestratorId` equals that orchestrator. Gateway registers `fleet_message` / `fleet_roster` after user skills. `GET /api/orchestration-feed`; `PATCH /api/sessions/:id` accepts `agentRole` (`agent` \| `orchestrator` \| legacy `standard`) and `linkedOrchestratorId`.
- **Fleet LLM prompts:** System prompt includes a **mission block** when `Session.description` / `Session.objective` are set (treat objective as success criteria). Role-specific playbooks: orchestrators delegate with `directive`/`reply`, task agents report with `update`/`reply`; chained team list shows full session ids plus description/objective hints. **`fleet_roster`** returns optional `description`/`objective` clips per session for targeting.
- **Autonomy & self-correction:** System prompt adds **Autonomy & essential outcome** (objective = primary deliverable; infer single outcome if absent) and **Self-correction & learning** (no blind retries, change strategy after errors, optional `store_memory` lesson keys). After any failed tool in a step, the **next** model iteration gets a one-shot **Priority note** suffix in the system prompt. Builder labels objective as **essential outcome**.

## Commands

- `npm run build` — Build all packages
- `npm run start` — Start gateway
- **`caprigo`** — CLI binary (`packages/cli`); use `npx caprigo`, `npm run caprigo -- …`, or `npm link` / `npm install -g ./packages/cli` so `caprigo` is on `PATH`
- `caprigo onboard` — Setup cheatsheet (same as `npm run caprigo -- onboard`)
- `caprigo skills` — List skills (gateway must run)

## MiroFish Integration (Optional)

Stored in `integrations/mirofish/` — copy to `skills/mirofish` to enable.

## MCP (Optional)

- **In-process client:** `@modelcontextprotocol/sdk` in `@caprigo/gateway` — stdio MCP servers from `gateway/mcp-servers.json` (Caprigo data root). Tools registered as `mcp_<serverId>_<tool>`. `GET/PATCH /api/mcp-servers`; `PATCH` persists and reconnects. Env: `CAPRIGO_DISABLE_MCP`, `CAPRIGO_MCP_TOOL_TIMEOUT_MS`.
- **Windows-MCP:** See `integrations/windows-mcp/` — same server can run under Caprigo **or** only under Cursor/IDE via `mcp-config.example.json`. `GET /api/runtime` includes `hostPlatform` for Windows-only UI hints.

## Roadmap

## Beta launch priorities (2026-04-27)

1. **Product lane**
   Ship Caprigo as a local-first agent workspace for technical operators/builders. The strongest differentiator is persistent agents that mix LLM chat, local scripts, skills, and orchestration on the user machine.

2. **Primary use cases**
   - Solo automation lab: coding, file work, shell/API tasks, and repeatable local scripts.
   - Operator console: orchestrator + worker agents for research/build/ops flows.
   - Skill workbench: install, assign, test, and refine skills/MCP tools against live agents.

3. **Usability issues to fix before feature expansion**
   - First run still has too many decisions up front.
   - Dashboard / Workspace / Chat / Desk concepts overlap.
   - Agent state is under-explained; users need objective, current step, blocker, and done state surfaced clearly.
   - Chat and workspace feel like separate products even though they are the same runtime.

4. **Beta UX direction**
   - Guided onboarding: backend, model check, first agent, first successful task.
   - Agent setup centered on role + objective + tools + runtime, not low-level config first.
   - Progress UI should emphasize outcomes and evidence, not only tool plumbing.
   - Keep advanced controls, but hide them behind secondary surfaces by default.

5. **Competitive stance**
   Caprigo should compete on control, inspectability, pluggable backends, and mixed LLM/offline execution, not on vague autonomy claims.

6. **Brand risk**
   Naming pressure now exists around Caprigo. Decide whether to keep, qualify, or rename before broader beta branding, docs, and distribution expand further.

## Recent progress (2026-04-27)

- Phase 2 kickoff (`workflow recipes` MVP):
  - Added Board-level **Workflow Recipes** as reusable orchestrator launch presets.
  - Recipes persist locally (`localStorage`) and include built-in workflow template selection, trigger metadata (`manual`, `file-change`, `daily-sweep` + condition), and optional lead markdown injected into the orchestrator session at launch.
  - This intentionally stays local/app-layer only (no new backend scheduler/service) to keep the iteration lightweight, inspectable, and compatible with the current architecture.
- Upstream merge pass 2 (`doctor`):
  - Added `caprigo doctor` as a support-grade diagnostic command.
  - It reports local `.env`, permissions, workspace, data-root, and gateway paths even when Caprigo is down.
  - When the gateway is reachable, it adds runtime workspace, provider/model, skills, offline scripts, and session counts.
- Upstream merge pass 1 (reviewed upstream agent-runtime repo):
  - Integrated the most relevant upstream concept into Caprigo's architecture: permission-hardened local tooling.
  - Added shared permissions support with `~/.caprigo/permissions.json`.
  - Filesystem tools now enforce approved scopes; shell execution now enforces a blocked-command list plus scoped working-directory rules.
  - This is intentionally a baseline hardening layer, not yet a full ask/approve UI flow.
- Web first-run handoff:
  - Added a Setup complete callout to Overview when backend/model are ready but no agents exist yet.
  - Purpose is to point users directly to the next product action: create the first agent.
  - This closes the last visible gap between installation/setup and actual agent operation in the web UI.
- Launcher polish:
  - Added `--launch` / `--no-launch` and `--open-browser` / `--no-open-browser` control to interactive setup via the wrapper/CLI path.
  - `setup.ps1` now ends with a clearer success handoff.
  - Added `launch.ps1` and `launch.bat` as lightweight post-setup starters for already-configured installs.
- Repo-root setup wrappers:
  - Added `setup.ps1` as the primary Windows install/build/setup entry point.
  - Added `setup.bat` as a thin launcher for users who prefer batch or double-click flow.
  - This reduces the beta install path to one obvious command at the repo root.
- Guided launch handoff:
  - `caprigo setup --interactive` can now optionally launch the gateway after config is written.
  - It waits briefly for `/health` and can open the local Caprigo Overview page automatically.
  - This turns setup into a closer approximation of an installer/onboarding flow instead of stopping at config authoring.
- Interactive setup path:
  - `caprigo setup --interactive` now prompts for provider, backend URL/base, default model, optional Vibes settings, and can write the repo `.env`.
  - Model discovery is attempted directly against Ollama `/api/tags` or OpenAI-compatible `/v1/models` when reachable.
  - Setup still keeps the user in control, but removes the need to hand-author first-run config in the common case.
- Setup surface improvements:
  - Added CLI command `caprigo setup` for first-run checks against gateway, backend reachability, default model, loaded skills, and first-agent creation.
  - Reworked the Overview first-launch panel into a live checklist driven by runtime state rather than static setup text.
  - This pushes Caprigo toward an installer/onboarding posture instead of assuming the user will infer the sequence from raw controls.
- Install/onboarding framing:
  - Added `INSTALL_AND_FIRST_RUN.md` as the recommended beta first-run path.
  - Added `LANDING_PAGE_BRIEF.md` to anchor public positioning and future website copy.
  - Updated CLI `caprigo onboard` and Overview/runtime copy to reinforce the intended boundary: user setup first, agent operation second.
- Branding cleanup for beta:
  - Removed most Hermes wording from README, LLM guide, smoke-test docs, and visible web setup copy.
  - Kept Hermes references where they function as upstream attribution or compatibility notes inside the vendored Agent Skills subtree.
  - Goal: user-facing Caprigo surfaces should read as Caprigo, not as a thin wrapper around Hermes.
  - Renamed vendored subtree from `skills/agentskills/hermes/` to `skills/agentskills/imported-hermes/` so repo layout signals provenance without making competitor naming the default visual anchor.
- First-commit extraction cleanup:
  - Synced small repo-facing cleanup into the extracted `C:\Users\Laptop\Desktop\New folder\Tools\Caprigo` copy.
  - Added generated skill DB ignores: `skills/.caprigo-skills-db.json`, `skills/.radbot-skills-db.json`.
  - Removed extracted-folder runtime artifacts after smoke testing: `.caprigo/`, `node_modules/`, and stale `skills/.radbot-skills-db.json`.
  - Adjusted a few user-facing doc lines so `Caprigo` repo copy reads cleanly for initial public commit.
- Beta smoke-test kit shipped:
  - `scripts/beta-smoke.ps1` exercises the gateway/API path with real Caprigo sessions.
  - `BETA_SMOKE_TEST.md` defines the release gate, expected outcomes, and manual UI / marketplace checks.
  - Orchestration and live marketplace install are treated as soft checks because they depend on model behavior and external marketplace state.
- Launch audit / positioning pass:
  - Added explicit `vibes-coded.com` marketplace-home framing for Caprigo.
  - Added connector context so imported Hermes-style or marketplace-linked skills are part of the product story for both users and LLMs.
  - Normalized more user-facing strings around `Overview`, `Board`, and `Session`.
  - Residual launch risks after this pass are mostly copy/docs cleanup, not core runtime failures.
- Global LLM guide support shipped:
  - Added automatic prompt injection for workspace-level file `CAPRIGO_LLM_GUIDE.md`.
  - Optional env overrides: `CAPRIGO_LLM_GUIDE_PATH` or `CAPRIGO_PROGRAM_GUIDE_PATH`.
  - Intended use: explain Caprigo itself to whatever LLM the user connects before the model tries to operate the product.
- Web beta UX pass shipped:
  - Agent Builder now offers starter templates for common roles.
  - Fleet view now explains Caprigo in outcome-first language and shows quick summary counts.
  - Agent cards surface focus/objective and a plain-language readiness/activity summary.
- Navigation/product-language cleanup shipped:
  - Top nav now reads `Overview`, `Board`, `Session`, `Settings`.
  - Overview is framed as setup + runtime/fleet readiness, Board as live operations, Session as one agent conversation.
- Standalone repo extraction done:
  - Created `C:\Users\Laptop\Desktop\New folder\Tools\Caprigo` with source/config/docs only.
  - Excluded `.env`, `node_modules`, and built `dist` folders to keep it git-ready.
- This was intentionally frontend-only to improve usability without destabilizing the runtime.

- [x] User skills loader
- [x] Native + legacy tool protocols
- [x] Persistent memory file
- [x] Vibes-Coded core skills + local pack reader
- [x] CLI onboard (`caprigo`)
- [x] Ollama or OpenAI-compatible remote API (`@caprigo/chat-backend`)
- [x] Workspace canvas UI (agents + visual chains, localStorage layout)
- [ ] **Caprigo Mesh** — cross-node agent networking / federation
- [ ] Hot reload of user skills

## 2026-04-27 notes

- Polling optimization pass:
  - session polling is no longer fixed at `800ms`
  - agent/status/system-monitor/orchestration refresh now backs off when the tab is hidden
  - goal is lower background CPU/network churn on laptops while keeping the UI responsive when the workspace is active
- Terminal noise + polish pass:
  - gateway request logging now defaults to `CAPRIGO_REQUEST_LOG=smart`
  - routine GET poll traffic is suppressed from stdout: `/health`, `/readyz`, `/api/runtime`, `/api/sessions`, `/api/system-monitor`, and orchestration-feed reads
  - web polling was relaxed again for fleet refresh, runtime refresh, orchestration feed, and system monitor widgets
  - CLI dashboard and `launch.ps1` now carry the "Capricorn x Virgo" branding with cleaner terminal framing
- Token-efficiency pass 1:
  - Added explicit prompt-budget controls for global guide injection, agent instruction files, inline instructions, compacted history, and tool-result echo.
  - Older session context now compresses into an “earlier conversation digest” after a recent-message window instead of replaying the entire chat verbatim.
  - Tool results sent back into the next model step are now capped, which should materially reduce prompt bloat after file reads, HTTP calls, or large JSON outputs.
  - Docs and `.env.example` now expose these knobs so token/cost tuning is intentional.
- Repo-aware context pass 1:
  - Added built-in `repo_map` skill for compact structural workspace mapping.
  - Current implementation is regex/syntax-heuristic based, not tree-sitter yet, but it already gives the agent file-relative class/function/interface/method context at much lower prompt cost than full-file injection.
  - Logical next step is combining `repo_map` + `search_files` + targeted `read_file` into a deliberate retrieval pipeline before the model sees large code bodies.
- Repo-aware context pass 2:
  - Added built-in `codebase_context` skill as that retrieval pipeline’s first concrete surface.
  - It returns candidate files, search hits, and compact repo-map slices in one response so the agent can choose 1-3 files to read instead of exploring blindly.
  - Next logical upgrade is tree-sitter-backed symbol extraction and/or lightweight relevance scoring beyond literal text hits.
- Repo-aware context pass 3:
  - Added lightweight relevance scoring to `codebase_context` and exposed ranked candidates with reasons.
  - Ranking currently uses a bounded heuristic: direct text hits, path token overlap, and symbol/signature overlap.
  - This is intentionally still cheap/local and roadmap-safe; it improves retrieval quality without introducing persistent indexing, embeddings, or a larger background service.
- Trace visibility pass 1:
  - Extended the existing execution log instead of creating a new observability subsystem.
  - Execution-log rows now include compact result summaries and output-size proxies, which helps explain retrieval choices and rough prompt/cost pressure.
  - Added per-session trace API plus a recent trace panel in agent details so operators can inspect recent tool/retrieval behavior in the product UI.
  - This satisfies the immediate roadmap need for replay/cost visibility while staying intentionally small.
- Repo-aware context pass 4:
  - Added AST-backed symbol extraction for TypeScript/JavaScript-family files using the TypeScript parser.
  - `repo_map` and `codebase_context` now have a more trustworthy symbol layer for the repo’s primary implementation language, while non-TS/JS files still fall back to the existing heuristic extraction.
  - This is still roadmap-safe: better structural retrieval quality without adding persistent indexes, embeddings, or a separate parser service.
- Fleet UX pass 1:
  - Board toolbar can now launch two starter crews directly: `Repo Crew` and `Automation Crew`.
  - Board context menu now supports direct role conversion (`agent` <-> `orchestrator`) and cleaner attach/detach flows instead of relying on the older source-centric chain action alone.
  - Board cards now surface fleet status more clearly: worker counts for orchestrators and reporting-pill state for linked workers.
  - Implementation is intentionally app-layer only for now: no separate crew-template persistence/API yet, which keeps the feature incremental and easy to revise.
- Fleet UX pass 2:
  - Board now gives visible feedback after launching a starter crew instead of silently dropping new sessions onto the canvas.
  - Role conversion is safer: orchestrators with attached workers cannot be downgraded until the links are removed, and a worker being promoted to orchestrator confirms detaching from its current crew.
  - Selected crew relationships are easier to read because related cards now get a lighter crew highlight and selected orchestrators/workers receive clearer lead/member labeling.
- MCP polish pass 1:
  - Settings now starts with curated MCP recommendations instead of only a blank server form.
  - Added one-click presets for the official workspace filesystem server and official GitHub server, plus Windows-MCP on Windows hosts.
  - Presets still write into the same saved MCP config and require the user to click `Save & connect`, so the UX is better without changing gateway persistence or bridge behavior.
- Trace visibility pass 2:
  - Recent trace entries now include a compact deterministic `why` summary so users can see why a tool was called without asking the model to generate extra reasoning text.
  - Added session trace export as markdown or JSON from the agent details dialog, built on top of the existing execution-log data instead of a new observability service.
  - Offline script trace rows now also record rationale, output-size estimates, and compact result summaries so replay is more uniform across LLM and offline flows.
- Resource dashboard pass 1:
  - Overview now includes a lightweight fleet-resource card instead of making users open the full system monitor for every check.
  - The card combines host pressure from `/api/system-monitor` with fleet state: thinking agents, offline agents, orchestrators, linked workers, errors, and gateway RSS.
  - This stays intentionally simple and local: no per-agent profiler or new backend metrics service, just better operator visibility on laptop load.
- Vibes-Coded polish pass 1:
  - Overview marketplace import now feels more like a product surface and less like a raw search box.
  - Added quick-search chips, a marketplace readiness/import summary, and a compact installed-marketplace-tools list so users can see what Vibes-Coded has already added to Caprigo.
  - This was kept separate from MCP on purpose: Vibes-Coded remains the marketplace story, while MCP remains the integration/configuration story.
- Overview workflow pass 1:
  - Added a small action layer in Overview that recommends the next concrete move from current state instead of only showing status.
  - The card can now route users straight into Settings, the agent builder, a starter crew launch, or a Vibes-Coded search depending on what is missing.
  - This is still lightweight productization: it guides the existing flows rather than introducing a new onboarding engine or persistence model.
- Handoff polish pass 1:
  - Overview fleet cards now give direct continuation actions instead of forcing users to infer whether Session or Board is the right next stop.
  - LLM agents can jump straight into Session, offline agents jump to Board, and both keep a fast Details path on the card face.
  - Session now exposes quick `Open board` / `Agent details` actions plus a small crew-role hint so orchestrators and linked workers feel connected to fleet operations instead of isolated chat tabs.
- Board crew grouping pass 1:
  - The Board canvas now renders a lightweight labeled shell behind each orchestrator-led crew instead of showing only individual cards and arrows.
  - Group bounds are derived from the existing saved card positions, so drag behavior and layout persistence stay unchanged.
  - This is intentionally visual-only: it improves fleet readability without introducing a new crew entity, auto-layout engine, or backend schema.
- Board crew actions pass 1:
  - Selecting any member of a crew now reveals a compact crew strip above the canvas.
  - The strip shows the lead, worker count, member chips, and direct lead actions so users can move around a crew without relying only on scattered card context menus.
  - This keeps the crew model lightweight and local to the existing Board UI; no new orchestration API or crew persistence layer was introduced.
- Starter crew guidance pass 1:
  - The transient Board launch notice now carries a real starter brief for the two built-in crews instead of only announcing that sessions were created.
  - Each crew now points users toward the lead first, includes a short checklist for the first task, and offers a one-click `Open lead session` action.
  - This remains app-layer only: no template backend, stored playbooks, or auto-generated first prompt yet.
- Starter crew guidance pass 2:
  - That `Open lead session` action now also seeds the Session composer with a structured starter draft for each built-in crew.
  - `Repo Crew` starts with a repo-task framing prompt; `Automation Crew` starts with a local-run framing prompt.
  - This is still intentionally lightweight: no saved per-crew prompt library or new backend template model, just a better first-use handoff.
- Trace summary pass 1:
  - The recent-trace panel now does more than list entries; it derives a quick pressure summary from the existing session trace.
  - Users can now see whether a session looks light, worth watching, or heavy based on recent call count, output volume, and total duration, plus the slowest tool, noisiest tool, and latest failure.
  - This stayed frontend-only on purpose so we did not add a new observability endpoint for what is essentially a presentation-layer summary.
- Workflow template pass 1:
  - Added `Launch Audit Crew` as the first more market-facing built-in workflow after the base starter crews.
  - It is now launchable from Overview and Board, creates a lead plus two focused workers (`Surface Checker` and `Risk Reviewer`), and ships with the same lead-first guidance/draft pattern as the other crews.
  - This keeps workflow packaging app-layer for now: no reusable template backend yet, but users now have a concrete launch-readiness workflow instead of only generic crews.
- Workflow template pass 2:
  - Added `PR Review Crew` as the next packaged workflow in the same family.
  - It is also launchable from Overview and Board and uses a lead-plus-workers pattern: `PR Review Lead`, `Diff Scout`, and `Risk Reviewer`.
  - The workflow is intentionally local-first: it can frame a hosted PR, branch, patch, or plain local diff without depending on a GitHub-only path.
- Workflow library pass 1:
  - Overview now includes a lightweight `Workflow library` card instead of making users discover packaged crews only through scattered buttons and recommendations.
  - The library lists each built-in crew with role makeup, use-case framing, and direct launch actions.
  - This is still lightweight and UI-only; it is a discovery layer over the existing built-in workflow launches, not a reusable workflow registry yet.
- Workflow library pass 2:
  - Added a shared workflow launcher dialog and a single workflow-library definition file for the built-in crews.
  - Board and Overview can now open the same workflow picker instead of each growing their own launch-button set.
  - This keeps the workflow layer consistent without introducing backend workflow persistence or a full workflow marketplace yet.
- Workflow metadata pass 1:
  - Session and agent details now surface lightweight built-in workflow identity after a crew is launched.
  - The UI infers workflow context from the lead/member naming pattern and shows what the workflow is for plus whether the current session is the lead or a member.
  - This keeps workflow explanation app-side and cheap; no backend workflow metadata or migration was introduced.
- Trace estimate pass 1:
  - Extended the recent-trace summary with rough context-token and output-token estimates plus a low/watch/high cost signal.
  - These values are explicitly heuristic and derived from trace text volume and tool output size, not from provider billing APIs.
  - This keeps the trust/cost layer lightweight while still warning users when a session is becoming context-heavy or operationally expensive.
- Trace warning pass 1:
  - Added lightweight per-session warnings on top of that heuristic layer.
  - Session now shows an inline warning when the selected agent's recent trace looks heavy, and Board cards now get a `Heavy` badge when their recent trace trends high.
  - The warning path reuses a shared frontend trace helper and the existing `/api/execution-log` tail; no new backend API was introduced.
- Trace estimate pass 2:
  - Added the same rough estimate block to the gateway-side session trace summary and export path.
  - Session trace totals and markdown/JSON exports now include estimated context tokens, output tokens, total tokens, pressure, and cost signal.
  - This keeps the live UI and exported replay artifacts aligned without adding provider-specific billing integrations.
- Renamed the product to Caprigo:
  - public product home is `caprigoai.com`
  - marketplace remains `vibes-coded.com`
  - workspace package scope is now `@caprigo/*`
  - CLI/bin is now `caprigo`
  - default data root is now `~/.caprigo`
  - removed the leftover compatibility shims from the abandoned pre-launch name
- Fixed the remaining legacy data-root leak. `caprigoDataRoot()` now prefers `~/.caprigo` unless `CAPRIGO_HOME` is explicitly set, and migrated legacy home data forward on this machine so `caprigo doctor` no longer reports the old branded path as Caprigo's active runtime root.
- [x] **In-process MCP client** — stdio servers, `mcp-servers.json`, `/api/mcp-servers`, Settings UI
- [x] **Windows-MCP** — docs + example configs (`integrations/windows-mcp`)
- 2026-04-27 website note:
  - Built the first `caprigoai.com` site in `C:\Users\Laptop\Desktop\New folder\Tools\Caprigo - Website`.
  - Stack is Next.js 16 with a single landing page, earth-tone brand direction, install guidance, and SEO essentials baked in.
  - Current deployment target is Railway with `npm run build` and `npm run start`.
  - Added a live stats strip and `/api/stats`; Railway Postgres can now back persistent site views while install/download totals remain env-driven until a real release/download source is wired in.
  - Created a private GitHub repo at `doteyeso-ops/caprigo-website` and pushed `main`, so the site is ready to import into Railway.
  - Live Railway service now exists at `caprigo-website-production.up.railway.app`; runtime stats are DB-backed and no longer depend on build-time DB access.
- 2026-04-29 runtime smoke:
  - Build still passes: `npm run build` and `npm run build:web`.
  - Live API smoke passed against local gateway on `127.0.0.1:18789`: created offline session, ran `gateway-ping`, verified `/api/sessions/:id/execution-log` plus markdown/JSON export include `rationale`, `resultSummary`, `outputChars`, estimated tokens, pressure, and cost signal.
  - Visual UI smoke was completed outside Codex browser-use by using headless Edge against a temporary local verification build, then reverting those verification-only source edits. Confirmed Overview workflow-library / recommended-next-move rendering, and Board rendering for workflow recipes, selected crew strip, linked-worker shell, and `Heavy` trace badge. Keep in mind: Codex browser-use remains blocked on this machine until the `node_repl` runtime reaches `>=22.22.0`.
