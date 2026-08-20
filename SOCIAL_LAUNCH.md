# Caprigo — Social Launch Pack

Copy-paste content for GitHub, X/Twitter, Hacker News, LinkedIn, and Reddit. Adjust tone to your voice before posting.

**Links to include everywhere:**
- Repo: https://github.com/doteyeso-ops/caprigo
- Site: https://caprigoai.com
- Marketplace: https://vibes-coded.com

**Before posting:** run `.\setup.ps1` or `npm run launch`, seed a demo crew (`node scripts/seed-demo-crew.cjs --reset`), capture fresh screenshots (`node scripts/capture-marketing-screenshots.cjs`), attach `docs/assets/overview.png` or `board-crew.png`.

---

## One-liner (bio / pin / tagline)

> Caprigo — local-first agent workspace. Persistent crews, real tools, your machine. Beta at caprigoai.com

---

## X / Twitter — single post

> Shipping Caprigo beta — a local-first agent workspace, not another chat wrapper.
>
> • Persistent agents + orchestrator/worker crews
> • Ollama or OpenAI-compatible backends
> • Board + Session + trace export
> • Skills + MCP + marketplace path
>
> MIT · Windows-friendly setup · github.com/doteyeso-ops/caprigo

**Attach:** `docs/assets/board-crew.png`

---

## X / Twitter — thread (optional)

1/ Caprigo is what I wanted after one too many "agent" products that were just chat with three tools bolted on.

Local-first. Persistent agents. Visible ops. Beta now.

2/ You connect the model once (Ollama, LM Studio, OpenRouter, whatever speaks OpenAI-compatible APIs).

Then you launch agents that actually operate: files, shell, scripts, MCP, marketplace skills.

3/ The workspace has four surfaces that map to how I work:
- Overview = setup + fleet readiness
- Board = live crew ops (orchestrator ↔ workers)
- Session = one agent conversation
- Settings = backend + MCP

4/ Built-in crews ship day one: Repo Crew, Automation Crew, Launch Audit, PR Review.

No YAML ceremony — click launch, get a lead + workers wired on the canvas.

5/ Trace visibility matters. Every tool call gets rationale + exportable replay.

If a session goes heavy, the UI tells you before your context window does.

6/ MIT repo, Windows `setup.ps1`, `caprigo doctor` for support-grade diagnostics.

Try it, break it, tell me what confused you:
github.com/doteyeso-ops/caprigo
caprigoai.com

---

## Hacker News — Show HN draft

**Title:** Show HN: Caprigo – local-first agent workspace with crews, tools, and trace export

**Body:**

Caprigo is a local-first agent runtime + web workspace I've been building for technical operators who want agents on a real machine — not a hosted black box.

What it does:
- Gateway + web UI on localhost (Overview / Board / Session / Settings)
- Persistent sessions with objectives, orchestrator/worker linking, offline script modes
- Tool loop over local skills, MCP servers, and marketplace imports (vibes-coded.com)
- Built-in workflow crews (repo work, automation, launch audit, PR review)
- Trace export with rough cost/heuristic signals

Stack: Node/TypeScript monorepo, Ollama or OpenAI-compatible backends, MIT license.

Install (Windows): clone repo, run `setup.ps1`, or `npm install && npm run build && npm run build:web && npm run start`.

I'm looking for beta testers who will actually run agents against real projects and report friction — especially first-run setup and Board/Session clarity.

Repo: https://github.com/doteyeso-ops/caprigo
Site: https://caprigoai.com

Happy to answer architecture questions in comments.

---

## LinkedIn

I've opened the Caprigo beta — a local-first agent workspace for people who need AI agents to operate on real files, real tools, and real scripts with full visibility.

Caprigo sits between your model, your skills, and your machine:
- Persistent agents with orchestrator/worker crews
- Web operator console (Board + Session)
- Ollama or OpenAI-compatible backends
- Trace export and permission-scoped filesystem/shell

If you're building with local LLMs or want inspectable agent ops instead of opaque autonomy marketing, I'd love feedback.

Repo: https://github.com/doteyeso-ops/caprigo
Site: https://caprigoai.com

---

## Reddit r/LocalLLaMA (short)

**Title:** Caprigo beta — local agent workspace with crew board, MCP, trace export (MIT)

**Body:**

Built a local-first agent platform: gateway + web UI, persistent sessions, orchestrator/worker crews, skills/MCP, works with Ollama or any OpenAI-compatible endpoint.

Not trying to be magic — trying to be operable. Board for fleet ops, Session for chat, built-in Repo/Automation/PR review crews.

Windows setup is one script (`setup.ps1`). `caprigo doctor` for diagnostics.

Looking for people to stress-test first-run and real project workflows.

https://github.com/doteyeso-ops/caprigo

---

## GitHub repo settings (manual)

Suggested description:

> Local-first agent workspace — persistent crews, tools/MCP, trace export. Ollama + OpenAI-compatible. MIT.

Suggested homepage: `https://caprigoai.com`

Suggested topics: `agents`, `local-first`, `ollama`, `mcp`, `ai-agents`, `llm`, `openai-compatible`, `typescript`, `self-hosted`

Command (optional):

```bash
gh repo edit doteyeso-ops/caprigo --description "Local-first agent workspace — persistent crews, tools/MCP, trace export. MIT." --homepage "https://caprigoai.com"
```

---

## Demo video script (60–90 sec)

1. **Hook (5s):** "This is Caprigo — agents that run on your machine, not in a black box."
2. **Overview (15s):** Show runtime connected, agent count, Create agent / Launch crew.
3. **Board (20s):** Launch Repo Crew — lead + two workers appear, linked on canvas.
4. **Session (15s):** Open lead, paste a concrete task, show tool trace panel.
5. **Close (10s):** "MIT, local-first, beta — link in bio."

---

## Auto — 2026-08-19

Created this pack alongside README screenshot section and `scripts/seed-demo-crew.cjs` + `scripts/capture-marketing-screenshots.cjs`. Regenerate assets before each public push.
