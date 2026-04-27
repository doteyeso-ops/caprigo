# Caprigo Beta Smoke Test

This runbook is the release gate for Caprigo beta. It combines an API/runtime smoke script with a short manual checklist for UI and marketplace behavior that cannot be made fully deterministic.

## Goal

Verify that a clean Caprigo install can:

1. start the gateway,
2. expose runtime health,
3. create and use agents,
4. run an offline script,
5. complete one basic LLM task,
6. attempt one orchestrator-worker flow,
7. reach `vibes-coded.com`,
8. and, when credentials/listing access exist, import one marketplace skill.

## Prerequisites

- Node.js 18+
- dependencies installed with `npm install`
- gateway buildable with `npm run build`
- web buildable with `npm run build:web`
- a working LLM backend:
  - local Ollama, or
  - an OpenAI-compatible API
- for marketplace import checks:
  - `VIBES_CODED_API_BASE` if not using the default
  - `VIBES_CODED_API_KEY` if the listing is gated or paid

## Automated smoke script

The smoke script can now launch Caprigo for you. From the repo root, execute:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\beta-smoke.ps1
```

Default behavior:

- runs `npm install` first if local build tooling is missing,
- builds Caprigo if gateway/web artifacts are missing,
- starts the gateway if it is not already reachable,
- waits for `/health`,
- checks available models from the active provider,
- uses the runtime default model when available,
- otherwise lets you pick an installed/exposed model for the smoke-test LLM sessions,
- then runs the smoke checks.

If you want the old behavior and do **not** want the script to launch Caprigo automatically:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\beta-smoke.ps1 -AutoStartGateway:$false
```

Useful options:

```powershell
# Keep created sessions for inspection after the run
powershell -ExecutionPolicy Bypass -File .\scripts\beta-smoke.ps1 -KeepSessions

# Use a token-protected gateway
powershell -ExecutionPolicy Bypass -File .\scripts\beta-smoke.ps1 -ApiToken "your_token"

# Force a specific model for the LLM sessions created by the smoke test
powershell -ExecutionPolicy Bypass -File .\scripts\beta-smoke.ps1 -SessionModel "qwen3:latest"

# Include a real marketplace install test
powershell -ExecutionPolicy Bypass -File .\scripts\beta-smoke.ps1 -VibesListingId "listing_id_here"

# Skip model-dependent or marketplace-dependent checks
powershell -ExecutionPolicy Bypass -File .\scripts\beta-smoke.ps1 -SkipFleet -SkipVibes

# Do not auto-launch the gateway
powershell -ExecutionPolicy Bypass -File .\scripts\beta-smoke.ps1 -AutoStartGateway:$false
```

## What the script checks

- `/health`
- `/api/runtime`
- `/api/skills`
- `/api/offline-scripts`
- creation of:
  - one orchestrator session
  - one worker session linked to that orchestrator
  - one offline session
- offline script execution and transcript logging
- one direct LLM worker reply
- one orchestrator-worker fleet attempt
- Vibes marketplace search reachability
- optional live marketplace install

## Expected automated result

- Hard pass:
  - gateway responds
  - sessions create successfully
  - offline script output is written to transcript
  - direct LLM task returns the expected token
- Soft pass:
  - orchestrator-worker flow produces transcript evidence
  - marketplace search returns listings
  - optional install succeeds when listing access is valid

The fleet and marketplace install checks are soft because they depend on live model behavior and external marketplace state.

## Manual beta checklist

### Overview

- Launch Caprigo and confirm `Overview` loads.
- Confirm runtime health is visible.
- Confirm `vibes-coded.com` / Vibes marketplace surfaces appear in runtime setup.
- Confirm agent creation opens role templates.

### Board

- Create at least:
  - one normal LLM agent
  - one orchestrator
  - one offline/local agent
- Switch runtime modes on the Board.
- Run an offline script from the Board.
- Chain the orchestrator to a worker.

### Session

- Open one Session from the Board.
- Send one direct task and confirm the reply is sane.
- Confirm local script output appears as `Local` transcript lines.
- Confirm fleet lines appear when orchestration messages are sent.

### Marketplace / connector

- Search public listings from `vibes-coded.com`.
- If you have a real listing id, install one Caprigo-compatible skill.
- Confirm it appears in skill assignment.
- If your external connector path is part of the beta story, test one connector-linked skill path and verify the marketplace relationship is clear in the user flow.

## Beta release notes

If something fails, record:

- exact command or click path,
- gateway URL,
- provider/model,
- whether `CAPRIGO_API_TOKEN` is set,
- whether marketplace credentials were set,
- and the first clear error text.

That turns the smoke run into a real launch gate instead of a vague demo pass.
