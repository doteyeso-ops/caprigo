# Caprigo Install And First Run

Caprigo is a **minimal local-first CLI harness**. You configure LM Studio (or another OpenAI-compatible backend), build the repo, and run the terminal HUD.

## Fastest Windows path

From the repo root:

```powershell
.\setup.ps1 -LaunchHud
```

Or step by step:

```powershell
.\setup.ps1 -NoLaunch
.\launch-hud.ps1
```

Batch wrapper: `setup.bat` · daily launcher: `launch.bat` (calls `launch-hud.ps1`).

## Prerequisites

- **Node.js 18+**
- **LM Studio** with Local Server enabled (default port `1234`)
- A **tool-capable model** loaded (e.g. `qwen2.5-coder-7b-instruct`)

Optional on Windows: Playwright Chromium for browser skills; desktop body uses built-in Windows automation.

## Install

```bash
git clone https://github.com/doteyeso-ops/caprigo.git
cd caprigo
npm install
npm run build
```

## Configure backend

```bash
cp .env.example .env
caprigo setup --interactive
# or auto-discover LM Studio:
caprigo connect --launch
```

Default LM Studio `.env`:

```env
CAPRIGO_LLM_PROVIDER=openai_compatible
OPENAI_BASE_URL=http://127.0.0.1:1234/v1
DEFAULT_MODEL=qwen2.5-coder-7b-instruct
CAPRIGO_HARNESS_MODE=1
```

Ollama alternative:

```env
CAPRIGO_LLM_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
DEFAULT_MODEL=qwen2.5-coder:7b
```

## Launch

```powershell
.\launch-hud.ps1
```

```bash
caprigo           # same as caprigo tui
caprigo doctor    # verify LM Studio + config
```

## First session

1. Confirm header shows **LM STUDIO ONLINE** (or your backend).
2. Try a harness mission: `open notepad and type hello world`
3. Watch tool cards in the Session pane; check Context caps (Desktop, Mission).
4. Use `/brain` to inspect lessons; `/bug` to pack a handoff report on failures.

Permissions baseline: `~/.caprigo/permissions.json` approves workspace and Caprigo data roots by default.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| LM Studio offline | Start Local Server; load a model; `caprigo connect` |
| Empty model replies | Prefer a tool-capable model; `/clear` and retry |
| Build missing | `npm run build` or `.\launch-hud.ps1 -Rebuild` |
| Doctor details | `caprigo doctor` |

## CLI reference

```bash
caprigo onboard              # print setup checklist
caprigo setup --interactive  # write .env
caprigo connect              # discover LM Studio on LAN
caprigo tui                  # embedded HUD
```
