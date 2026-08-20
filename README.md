# Caprigo

[![visitors](https://myhits.vercel.app/api/hit/https%3A%2F%2Fgithub.com%2Fdoteyeso-ops%2Fcaprigo?color=blue&label=visitors&size=small)](https://myhits.vercel.app)
[![website](https://img.shields.io/badge/site-caprigoai.com-8B7355?style=flat)](https://caprigoai.com)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat)](LICENSE)

**Local-first agent harness in your terminal.** Connect LM Studio (or any OpenAI-compatible API), run `caprigo`, and operate through a multi-pane HUD — embedded runtime, live tool cards, HOME missions, desktop body. **No gateway. No browser dashboard.**

| | |
|-|-|
| **Site** | [caprigoai.com](https://caprigoai.com) |
| **Credit** | **b_Radford** · [Vibes-Coded](https://vibes-coded.com) |
| **Stack** | Node · TypeScript · LM Studio · MIT |

---

## The HUD

Default path: start LM Studio → load a tool model → launch the harness.

![Caprigo CLI HUD — LM Studio online, notepad HOME mission with tool cards](docs/assets/hud-terminal.png)

| Pane | What you see |
|------|----------------|
| **Header** | `LM STUDIO ONLINE`, model name, busy pinwheel |
| **Agents** | Active session, `/loop` `/think` `/models` |
| **Session** | User turns, `╭─ tool` cards, mission verified |
| **Context** | Caps — Desktop, OCR, Web, Brain, Mission, Goal |
| **Input** | Double-Enter STEER, `/bug` `/brain` `/clear` |

### Mission examples

<p align="center">
  <a href="docs/assets/hud-web-mission.png"><img src="docs/assets/hud-web-mission.png" alt="Web search + fetch tool loop" width="48%" /></a>
  <a href="docs/assets/hud-write-mission.png"><img src="docs/assets/hud-write-mission.png" alt="write_file + browser preview" width="48%" /></a>
</p>

| Mission | What happens |
|---------|----------------|
| **Desktop** | `open notepad and type hello` → HOME playbook, OCR verify |
| **Web** | Search + fetch with visible tool cards in Session |
| **Write** | `write_file` → browser preview of generated HTML |

---

## Quick start

**Windows (fastest)**

```powershell
git clone https://github.com/doteyeso-ops/caprigo.git
cd caprigo
.\setup.ps1 -LaunchHud
```

**Manual**

```bash
git clone https://github.com/doteyeso-ops/caprigo.git
cd caprigo
npm install
npm run build
cp .env.example .env   # LM Studio defaults inside
.\launch-hud.ps1       # Windows
# caprigo              # same as caprigo tui
```

**Prerequisites:** Node 18+, [LM Studio](https://lmstudio.ai) Local Server on `:1234`, a tool-capable model (e.g. `qwen2.5-coder-7b-instruct`).

```bash
caprigo doctor          # verify backend + .env
caprigo connect         # auto-discover LM Studio on LAN
caprigo setup -i        # interactive .env setup
```

---

## Configure LM Studio

`.env` at repo root:

```env
CAPRIGO_LLM_PROVIDER=openai_compatible
OPENAI_BASE_URL=http://127.0.0.1:1234/v1
DEFAULT_MODEL=qwen2.5-coder-7b-instruct
CAPRIGO_HARNESS_MODE=1
```

Ollama works too — see [`.env.example`](.env.example).

---

## Why a harness

Models keep getting better; most wrappers are still a chat box with hidden tools. Caprigo is the **execution layer**:

- **HOME** — harness compiles intent into playbooks and runs bootstrap steps *before* the first LLM reply
- **Auto-drain** — finishes steps when the model ignores native `tools[]`
- **Digital body** — `desktop_*` mouse/keyboard/OCR on Windows, Playwright browser, shell
- **Brain + stumble** — sticky lessons, failure recovery, model dialect profiles
- **STEER** — double-Enter mid-turn injection while a tool loop is running
- **`/bug`** — handoff packs under `~/.caprigo/bug-reports/`

Lean mode for 8GB GPUs: `CAPRIGO_LEAN_TOOLS=1` (see `.env.example`).

---

## CLI reference

| Command | Purpose |
|---------|---------|
| `caprigo` / `caprigo tui` | Launch embedded HUD (default) |
| `.\launch-hud.ps1` | Windows launcher (builds if needed) |
| `caprigo doctor` | Config + LM Studio probe |
| `caprigo connect` | Discover LM Studio, write `.env` |
| `/loop` `/brain` `/bug` | In-HUD slash commands |

---

## Docs

- [INSTALL_AND_FIRST_RUN.md](INSTALL_AND_FIRST_RUN.md) — first-run walkthrough
- [docs/SCREENSHOTS.md](docs/SCREENSHOTS.md) — regen assets (`npm run screenshots`)
- [SOCIAL_LAUNCH.md](SOCIAL_LAUNCH.md) — share copy
- [HandOff.md](HandOff.md) — agent handoff notes

**Future (in repo, not default):** web workspace / gateway — `npm run build:legacy` when needed.

---

## License

MIT — see [LICENSE](LICENSE).
