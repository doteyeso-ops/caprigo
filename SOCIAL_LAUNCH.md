# Caprigo — Social Launch Pack (CLI HUD)

Copy-paste for GitHub, X, HN, Reddit. **Caprigo is the embedded CLI HUD** — `caprigo` / `launch-hud.ps1`.

**Links:** [github.com/doteyeso-ops/caprigo](https://github.com/doteyeso-ops/caprigo) · [caprigoai.com](https://caprigoai.com)

**Before posting:** `npm run screenshots` → attach assets from `docs/assets/` · optional live capture per [docs/SCREENSHOTS.md](docs/SCREENSHOTS.md)

| Asset | Use |
|-------|-----|
| `hud-terminal.png` | README hero, general posts |
| `hud-web-mission.png` | Web/tool-loop demo |
| `hud-write-mission.png` | File write demo |
| `hud-og.png` | GitHub social preview, link cards (1200×630) |

---

## One-liner

> Caprigo — local agent harness in your terminal. LM Studio in-process, multi-pane HUD, desktop body, long-horizon tool loops. MIT.

---

## X — single post

> Shipping Caprigo — a terminal agent harness, not another browser chat wrapper.
>
> • `caprigo` → embedded HUD (no gateway)
> • LM Studio / OpenAI-compatible in-process
> • Tool loops + desktop body + brain/stumble
> • HOME missions that finish playbooks without waiting on the model
>
> `.\launch-hud.ps1` on Windows · github.com/doteyeso-ops/caprigo

**Attach:** terminal screenshot or `docs/assets/hud-terminal.png`

---

## X — thread

1/ Built Caprigo because I wanted a **terminal harness** that actually runs tools on my machine — not a hosted chat UI with three functions bolted on.

2/ Default path: start LM Studio, load a tool model, run `caprigo`. Agent runs **in-process**. No server required.

3/ The HUD is multi-pane: agents, live session log with tool cards, Context/Caps (Desktop, OCR, Web, Brain, Mission), double-Enter STEER.

4/ Harness-owned missions (HOME): notepad type, web answer, write file — bootstrap before the first LLM reply, auto-drain when the model ignores tools[].

5/ Digital body on Windows: `desktop_*` mouse/keyboard/screenshot + WinRT OCR. Browser via Playwright. `/bug` packs for handoff.

6/ MIT, Windows-friendly, clone and run in minutes.

Try it: github.com/doteyeso-ops/caprigo · caprigoai.com

---

## Hacker News — Show HN

**Title:** Show HN: Caprigo – embedded CLI agent harness for LM Studio with multi-pane HUD

**Body:**

Caprigo is a local agent harness that runs in your terminal against LM Studio (or any OpenAI-compatible API) **without a gateway**.

`caprigo` launches a multi-pane HUD: session log with tool cards, caps panel (desktop/OCR/web/brain), model load pinwheel, STEER double-Enter input.

The harness executes HOME playbooks before the first model turn, auto-drains when models ignore native tools, and includes Windows desktop body skills (screenshot/OCR/click/type).

Stack: Node/TypeScript, embedded Agent in `@caprigo/cli`, MIT.

Quick start (Windows): clone, `npm install`, `npm run build`, start LM Studio, `.\launch-hud.ps1`.

Repo: https://github.com/doteyeso-ops/caprigo

---

## Demo video script (60s)

1. **Hook:** "Caprigo is an agent harness in your terminal — LM Studio in-process, no gateway."
2. **Launch:** `launch-hud.ps1`, show HUD header (LM STUDIO ONLINE, model name).
3. **Task:** "open notepad and type hello" — show tool cards in session pane.
4. **Caps:** point at Context panel (Desktop ok, Mission verified).
5. **Close:** "MIT, Windows-friendly, link in bio."

---

## Auto — 2026-08-19

CLI HUD is the sole product surface; web/gateway paths removed from default install and marketing.
