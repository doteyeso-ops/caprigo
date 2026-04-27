# Caprigo Install And First Run

Caprigo should feel simple at the boundary:

- the **user** sets up Caprigo,
- the **agent** operates inside Caprigo after setup is complete.

This is the intended beta path.

## Fastest Windows path

From the repo root:

```powershell
.\setup.ps1
```

Or use:

```bat
setup.bat
```

That wrapper runs dependency install, package builds, web build, and then launches `caprigo setup --interactive`.

Useful wrapper switches:

```powershell
.\setup.ps1 -Launch
.\setup.ps1 -NoLaunch
.\setup.ps1 -OpenBrowser
.\setup.ps1 -NoOpenBrowser
```

For normal day-to-day startup after setup is already done:

```powershell
.\launch.ps1
```

## What the user does

1. Install prerequisites.
2. Start Caprigo.
3. Confirm runtime health.
4. Verify the model.
5. Create the first agent.

## What the agent does

After setup, the agent can:

- chat through the connected model,
- use assigned tools and skills,
- run local scripts when the session/runtime mode allows it,
- coordinate other agents if it is an orchestrator,
- operate against the user workspace and connected services.

## Recommended install path

### 1. Install dependencies

```bash
npm install
```

### 2. Build Caprigo

```bash
npm run build
npm run build:web
```

### 3. Configure the LLM backend

Default local path:

```env
CAPRIGO_LLM_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
DEFAULT_MODEL=qwen3.5:latest
```

Remote API path:

```env
CAPRIGO_LLM_PROVIDER=openai
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your_key_here
DEFAULT_MODEL=gpt-4o-mini
```

### 4. Start Caprigo

```bash
npm run start
```

Then open `http://127.0.0.1:18789`.

### 5. Use Overview first

On first launch, the user should do this in order:

1. Open `Overview`.
2. Confirm LLM/backend health.
3. Confirm the intended model.
4. Confirm skills and optional marketplace imports.
5. Create one focused agent.

Caprigo also writes a baseline permissions file at `~/.caprigo/permissions.json`. By default it approves the workspace root and Caprigo data root for filesystem/shell working-directory access.

### 6. Let the agent operate

Use:

- `Session` for one agent conversation
- `Board` for offline scripts, orchestration, and fleet operations
- `Settings` for engine and connection changes

## CLI shortcut

Caprigo includes a quick setup helper:

```bash
caprigo onboard
caprigo setup --interactive
```

`caprigo onboard` is the short reference. `caprigo setup --interactive` is the guided first-run path for choosing provider, model, writing `.env`, optionally launching the gateway, and opening Overview.

For troubleshooting:

```bash
caprigo doctor
```

`doctor` reports local paths/config even if the gateway is down, then adds runtime details when Caprigo is reachable.
