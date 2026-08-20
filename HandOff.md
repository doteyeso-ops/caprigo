# HandOff — Caprigo

## Auto (2026-08-19) — Launch pack for online clout

Shipped share-ready surface area (no commit yet — large local diff still unpushed):
- **README** rewritten: hero screenshot, badges, use cases, workflow crews, links to `SOCIAL_LAUNCH.md`
- **`SOCIAL_LAUNCH.md`**: copy-paste posts for X, HN, LinkedIn, Reddit + demo video script
- **`docs/assets/`**: fresh screenshots via `scripts/capture-marketing-screenshots.cjs` (overview, board-crew, session)
- **`scripts/seed-demo-crew.cjs`**: API seed for Repo Crew demo
- **UX fixes for demos:** Board recipes HUD defaults collapsed; removed auto-jump to Board on page load when agents exist; `/?tab=overview|board|session` deep links

**To post:** regen screenshots if UI changed → push repo → use `SOCIAL_LAUNCH.md` → attach `docs/assets/board-crew.png`.

GitHub repo description/homepage updated via `gh repo edit` → caprigoai.com.

— Auto

## Auto (2026-08-11) — Night learn cycle 2 (pause)

Suite again **18/18**, then tightened soft OCR false-positive:
- Notepad e2e opens a **unique** `generated/desktop/e2e-*.txt` so focus targets that title, not random/IDE windows
- OCR pass requires marker **and** Notepad context; rejects Cursor-only chrome
- New live smoke: `scripts/smoke-e2e-home-notepad.cjs` — HOME autodrain typed marker in **~11s / 0 LMS tokens** (`mission_verified:pass`)
- Suite runner now includes home-notepad live test

**Pause state:** green. Morning: relaunch HUD `-Rebuild` if not yet; try `/clear` + notepad/web asks; `/bug` on any hitch. Model stays `qwen2.5-coder-7b-instruct`.

— Auto

## Auto (2026-08-11) — Learning suite → desktop focus fix

Ran `node scripts/run-learning-suite.cjs` (offline+live). First pass **17/18**; fail was Notepad e2e OCR (typed into Cursor / focus steal).
**Fix:** `desktop-win.ps1` focus now ranks titles (prefer real Notepad over IDE chrome), AttachThreadInput + BringWindowToTop, clicks client area; HOME types with `paste:true`. Brain lesson `desktop_type_into_wrong_window`.
Re-suite: **18/18 PASS**. Reports: `~/.caprigo/test-runs/LATEST.txt`.

— Auto

## Auto (2026-08-11) — Bug reporter + STEER + unknown-skill lessons

**Bug packs:** `/bug [note]` → `~/.caprigo/bug-reports/<iso>-*.md` (+ JSON). Auto on turn errors, stumble escalate, process crash. `/bugs` lists. Point next agent at `~/.caprigo/bug-reports/LATEST.txt`.

**STEER:** Enter = newline; Enter again ≤500ms = send (`CAPRIGO_STEER_ENTER_MS`). Ctrl+Enter sends now. Slash cmds still single-Enter. While busy, Enter/`/steer` injects mid-turn after next tool (`agent.steerTurn`). `CAPRIGO_BUSY_MODE=queue` to only queue.

**Unknown skills:** ambiguous `search`/`find`/`lookup` lessons were stored as bare `unknown_skill`. Now `unknown:search` + actionable fix; intent `prefer: web|local` remaps when user message is clearly web/local.

**Scout:** `node scripts/scout-ecosystem.cjs` → `~/.caprigo/scout/` (Hermes CLI STEER confirmed viable; already adopted). LMS `.act()` is parallel to our HOME loop — keep Caprigo harness; stay on Qwen2.5-coder for tools (LMS docs agree).

Smokes: `smoke-bug-report.cjs`, `smoke-tool-dialect.cjs`. Relaunch HUD `-Rebuild`.

— Auto

## Auto (2026-08-11) — Loop breaker (HOME + taskMode)

Cause: (1) `proposeNextActions` re-offered `desktop_focus` after a failed attempt; (2) after auto-pick exhaust, agent `continue`d with Action Cards forever; (3) HOME sets `objective` → `taskMode`, and missing `STATE:` defaulted to **continue** up to ~40 iters.
Fix: skip already-attempted tools; one post-drain LLM wrap-up then **break**; HOME missions never enter STATE:continue churn; explicit `STATE: continue` required for /loop.
Smoke: `node scripts/smoke-harness-mission.cjs` (includes no-refocus assert). Relaunch HUD after rebuild.

— Auto

## Auto (2026-08-11) — Prompt briefing + optional fast model

LMS "prompt processing" = prefill(context × model size). A second model only helps if it sees **less** context.
- Caprigo **translates** fat tool JSON → one-liners before inference (`prompt-brief.ts`, `CAPRIGO_PROMPT_BRIEF=1`)
- Optional `CAPRIGO_FAST_MODEL=google/gemma-3-4b` — small model answers **after** tools ran; DEFAULT_MODEL still does tool turns
- HOME auto-drain still skips LMS entirely for playbooks

— Auto

## Auto (2026-08-11) — Lean prompts (faster LMS prefill)

Safe speedups (default on, no HOME breakage):
- `CAPRIGO_LEAN_PROMPTS=1` — short system rules; no duplicate skill encyclopedia when native `tools[]` sent
- Tool descriptions truncated (`CAPRIGO_TOOL_DESC_CHARS=140`) — ~22KB→much smaller tools JSON
- Mission-scoped tools[] (desktop mission ≠ all 46 skills)
- Notepad playbook skips OCR (~2s×2 WinRT saved)
- HOME auto-drain runs **before** ensureProfile / fat prompt — finished playbooks never hit LMS

Disable lean: `CAPRIGO_LEAN_PROMPTS=0`

— Auto

## Auto (2026-08-11) — HOME auto-drain (fix LMS tool-ignore)

Hermes recovery nudges weren't enough when LMS ignores `tools[]`.
- **HOME auto-drain** (default on): after bootstrap, harness runs remaining playbook steps immediately — no LLM wait. `CAPRIGO_HOME_AUTODRAIN=0` to disable.
- Default model switched to **`qwen2.5-coder-7b-instruct`** (box has it; groq-tool-use ignores tools).
- Notepad/web/html playbooks should complete on first turn via harness.

Smoke: `node scripts/smoke-harness-mission.cjs`

— Auto

## Auto (2026-08-11) — Hermes patterns (why they feel smarter)

Read NousResearch/hermes-agent: they are not magic — strong tool models + **recovery loops**.
Ported into Caprigo:
- Session **`todo`** skill + HOME seeds checklist from mission steps (Hermes `todo_tool.py`)
- **Narration-stop nudge** when model says "I'll…" / "Let me…" with no tools (Hermes kanban/dropped-call style)
- **Empty-after-tools nudge** so silent replies after tool results continue the loop
- Still: HOME bootstrap before first LLM call

Smoke: `node scripts/smoke-hermes-recovery.cjs`
Why Caprigo still struggles more on LMS: `llama-3-groq-*-tool-use` often **ignores `tools[]`** entirely — Hermes usually runs models that emit real tool_calls. Prefer `qwen2.5-coder-7b-instruct` for tool loops.

— Auto

## Auto (2026-08-11) — HOME (Harness-Owned Mission Executor)

Leap: model is worker; harness is executive. No more wait-for-refusal loops as the primary path.
- `packages/agent/src/harness-mission.ts` — `compileMission` → playbooks (`desktop_notepad_type`, `web_answer`, `write_html_file`) + bootstrap steps
- `packages/agent/src/action-card.ts` — constrained `{"caprigo":"action|done|blocked"}` when LMS ignores `tools[]`
- `Agent.processMessage` runs **bootstrap before first LLM call**; on refuse → auto-pick remaining; `verifyMission` owns done
- Kill switch: `CAPRIGO_HOME=0`
- HUD Caps **Mission** `kind/playbook`; activity: `mission_compiled|bootstrap|action|verified`
- Smoke: `node scripts/smoke-harness-mission.cjs`
- Reactive force-web/desktop kept as fallback when HOME did not compile that kind

Relaunch HUD after rebuild. `/clear` then try `open notepad and type hello world` — expect launch+screenshot on first turn.

— Auto

## Auto (2026-08-11) — Desktop OCR (sight for body)

Text models can't see PNGs — OCR turns screenshots into clickable blocks.
- Skills: `desktop_ocr`, `desktop_find`; `desktop_screenshot` accepts `ocr:true`
- Default engine: **WinRT** Windows.Media.Ocr (~2s). Optional **RapidOCR** via `packages/agent/.venv-ocr`
- Setup RapidOCR: `powershell -File scripts/setup-desktop-ocr.ps1` then `CAPRIGO_OCR_ENGINE=rapidocr`
- Loop: screenshot → ocr/find → `desktop_click` cx,cy → verify
- HUD Caps **OCR** `winrt|rapidocr|off`; smoke: `node scripts/smoke-desktop-ocr.cjs`
- Full suite: `CAPRIGO_DESKTOP_E2E=1 CAPRIGO_DESKTOP_SMOKE_CLICK=1 node scripts/smoke-digital-body-suite.cjs`
- Fixed: `desktop_focus` EnumWindows callback now uses `$script:focusNeedle` (local `$needle` was invisible)
- Relaunch: `.\launch-hud.ps1 -Rebuild` now builds **agent + cli** (desktop skills live in agent)
- Fix (2026-08-11): empty “could not produce a response” — (1) LM Studio rejected tools missing `properties` (normalize in `skillToOllamaTool`); (2) `llama-3-groq-*-tool-use` was mis-profiled as XML/`refuses_openai_tools` — now openai. Cleared/rewrote `~/.caprigo/model-profiles.json` entry. HUD `/clear` then retry.
- Note: on box LMS, `llama-3-groq-8b-tool-use` currently **ignores** `tools[]` (prompt_tokens stay tiny; canned “no capability” refusal). Prefer `qwen2.5-coder-7b-instruct` for tool loops, or enable tools for that model in LM Studio. Don’t treat empty reply as context overflow.
- Fix (2026-08-11): dealers/local web asks — harness **force-executes `web_search`** when model refuses/skips tools; widened `userLikelyNeedsWeb` + capability refusal detect; fallback formats results if model still refuses. Smoke: `node scripts/smoke-e2e-dealers.cjs`
- Fix (2026-08-11): `write_file` **mkdir -p** parents (ENOENT on `animation/sunset…`); stumble ENOENT hint; block “want me to try again?” after tool fail → forced retry
- Fix (2026-08-11): stumble learning — lessons now save on **first** failure (were waiting for 3×); sticky tags; concrete REQUIRED FIX; user-message nudge (system-only was ignored); no XML dialect flip for openai tool-use models on embedded JSON; success rewrites lesson. Smoke: `node scripts/smoke-stumble-learn.cjs`
- Fix (2026-08-11): computer-use was **model-delegated only** (prompt + skills). LMS often ignores tools → never called `desktop_*`. Harness now **force-runs** `execute_command` launch (notepad/calc/…) + `desktop_screenshot(ocr:true)` when OS-UI intent + refuse/skip, then requires follow-up tools. Caps Desktop must be `ok`. Smoke: `node scripts/smoke-desktop-routing.cjs`

— Auto

## Auto (2026-08-11) — Digital body (desktop_*)

First-party Windows OS control in harness (no MCP): `desktop_screenshot|click|move|type|hotkey|key|windows|focus`.
- Impl: `packages/agent/src/skills/desktop.ts` + `desktop-win.ps1` (SendInput / GDI+)
- Kill switch: `CAPRIGO_DISABLE_DESKTOP=1`
- Routing: shell → `execute_command`; web → `browser_*`; native UI → `desktop_*` (shot→act→verify)
- HUD Caps **Desktop** `ok|off|non-win`; sticky Brain `os_ui_needs_desktop_screenshot_loop`
- Smoke: `node scripts/smoke-desktop.cjs` (optional click with `CAPRIGO_DESKTOP_SMOKE_CLICK=1`)

Relaunch HUD after agent/cli rebuild.

— Auto

## Auto (2026-08-11) — Image gen live (Forge)

Forge on `10.0.0.27:7860` with SD 1.5 is up. Caprigo `generate_image` → `generated/images/`.
- Fixed: no longer mistook `OPENAI_BASE_URL` (LM Studio) for Forge
- Defaults: 512² / 15 steps (RX580). Caps shows checkpoint name when ready.
- Smoke: `node scripts/smoke-image-gen.cjs`
- Keep Forge running: `C:\AI\start-webui.cmd` on box / `scripts/bootstrap-forge-box.ps1`

Relaunch HUD → Caps Image should show `v1-5-pruned-emaonly`.

— Auto

## Auto (2026-08-11) — Learning from refusals (fixed)

Root cause: lessons existed but weren’t sticky / weren’t matched to the **user turn**.
- `ensureCoreLessons()` seeds sticky web/refusal lessons every turn
- Brain prompt uses **user message** (not only mission objective)
- Sticky tags always surface; stronger “MUST follow” wording
- Refusal detector widened; nudges even if model used `search_files` for a web Q
- Mid-turn `refreshSystem` after lesson save; end-of-turn episodes on success/fail

Relaunch HUD. `/brain` should show sticky lessons.

— Auto

## Auto (2026-08-11) — Brave HTML (no API key)

Default `web_search` hits **search.brave.com** HTML SERP — no Brave/Gemini keys required.
Optional keys still work if present. Auto: Brave HTML → (Gemini if keyed) → DDG.

— Auto

## Auto (2026-08-11) — Brave vs Gemini web_search

**Prefer Brave for Caprigo** (structured SERP → local model + web_fetch). Gemini grounding is optional for pre-digested Q&A.

Auto order: **Brave → Gemini → DDG**
- `BRAVE_API_KEY` / `BRAVE_SEARCH_API_KEY`
- `GEMINI_API_KEY` / `GOOGLE_API_KEY`
- `CAPRIGO_WEB_SEARCH=auto|brave|gemini|ddg`

— Auto

## Auto (2026-08-11) — Google AI web_search

`web_search` uses **Gemini + Google Search grounding** when `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set.
- `CAPRIGO_WEB_SEARCH=auto|gemini|ddg` (default auto)
- `CAPRIGO_GEMINI_SEARCH_MODEL=gemini-2.5-flash`
- Parses answer + `groundingChunks` sources for the local model to relay
- Falls back to DDG if Gemini fails (auto mode)

HUD Caps shows `Web gemini|ddg|need key`. **Needs your Gemini API key in `.env`.**

— Auto

- HUD: braille pinwheel while **busy** (header + input footer), not only model-load.
- `web_search`: DDG Instant Answer + **HTML SERP fallback** (local/meetup queries were empty before).
- Knowledge-refusal nudge: if model says "no direct information" with **zero tools**, force `web_search` + auto brain lesson.
- Prompt: never claim no internet — tools first.

Forge: `:7860` was listening / loading SD1.5. Relaunch HUD after rebuild.

Smoke: `node scripts/smoke-web-search-routing.cjs`

— Auto

## Auto (2026-08-11) — Search routing (web vs local)

Bare `"search"` no longer aliases to `search_files`. Prompt + skill descriptions distinguish:
- **web_search** = internet / look up / google / facts
- **search_files** = local repo grep only

Aliases: `google`/`websearch` → web; `grep`/`find_in_files` → local. Ambiguous `search`/`find`/`lookup` → unknown + both suggestions.

Relaunch HUD after agent/cli rebuild.

— Auto

## Auto (2026-08-11) — Brain + Stumble + Model Grapple

**WinRM box:** `bot` / `1` @ `10.0.0.27`. Forge still installing under `C:\AI\…`.

**Shipped (relaunch HUD)**
- Caprigo Brain: `~/.caprigo/brain.json` — working memory + lessons + episodes
- Skills: `brain_status` / `brain_remember` / `brain_recall` / `save_skill_playbook` / gated `create_skill`
- Stumble-to-walk: fail → diagnose/retry → escalate; auto-lesson on repeat/blocked; multi verify churn
- Model Grapple: profiles in `~/.caprigo/model-profiles.json` (LMS/heuristic/handshake/observed flip)
- HUD: Caps Dialect+Brain, `/brain`, `/profile` [`probe`], stumble/dialect events
- `/clear` + `/new` reset working memory only

Env: see `.env.example` (`CAPRIGO_STUMBLE*`, `CAPRIGO_TOOL_DIALECT`, `CAPRIGO_MODEL_HANDSHAKE`, …)

Smoke: `node scripts/smoke-tool-dialect.cjs` · `node scripts/smoke-brain-stumble.cjs` · `node scripts/smoke-model-profile.cjs`

— Auto
