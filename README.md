# Caprigo

**Caprigo** is a local-first agent workspace for people who want AI agents to do real work on a real machine.

It gives you a persistent workspace where agents can:

- use tools and local files
- run scripts on your machine
- work in single-agent or orchestrator/worker flows
- install marketplace skills
- stay inspectable instead of turning into a black box

The public product home for the beta is **[caprigoai.com](https://caprigoai.com)**.

For the current beta, **[vibes-coded.com](https://vibes-coded.com)** is Caprigo's marketplace home. That is where Caprigo skills can be browsed, bought, sold, and imported into the runtime.

## What Caprigo includes

- **Caprigo Core**: the runtime engine for agents, skills, sessions, and the gateway
- **Caprigo CLI**: the command-line client for setup, diagnostics, agents, and chat
- **Web workspace**: Overview, Board, Session, and Settings
- **Skills system**: local skills, imported playbooks, MCP tools, and marketplace installs

## Why it is different

Caprigo is built for practical operation, not vague autonomy demos.

- **Local-first execution**: keep agents close to your files, scripts, and machine state
- **Model flexibility**: use Ollama locally or an OpenAI-compatible backend
- **Visible agent state**: see sessions, objectives, transcripts, scripts, and orchestration
- **Skill-based expansion**: add capabilities without rewriting the core runtime
- **Operator control**: keep setup, permissions, and runtime behavior explicit

## Skills in plain language

Caprigo skills are the actions an agent can take.

- **Core skills**: read and write files, search folders, call HTTP APIs, inspect the system, and run commands
- **Offline scripts**: run local scripts without sending the task through an LLM chat loop
- **Marketplace skills**: pull in packaged capabilities from `vibes-coded.com`
- **MCP tools**: connect external tool servers and expose them inside Caprigo
- **Agent playbooks**: load structured `SKILL.md` workflows that teach agents how to perform repeatable tasks

This means Caprigo is not just a chat app with tools. It is a workspace where agents can be equipped with reusable abilities and operated like actual workers.

## Beta use cases

- software and automation agents that work inside a real project folder
- research operators that gather, summarize, and hand off findings
- local script runners for repeatable tasks
- orchestrator/worker agent setups for multi-step jobs
- skill development and testing for marketplace delivery

## Quick Start

```bash
npm install
npm run build
npm run build:web
npm run start
```

This starts the Caprigo gateway on `http://localhost:18789`.

For the guided Windows path:

```powershell
.\setup.ps1
```

After setup, normal startup is:

```powershell
.\launch.ps1
```

## First-run commands

```bash
caprigo setup --interactive
caprigo doctor
caprigo agents create -n "Coder"
caprigo skills
caprigo models
```

## How setup works

Caprigo is designed around a clear boundary:

- the **user** sets up the runtime, model, and permissions
- the **agent** operates inside that environment after setup is complete

The interactive setup flow can write `.env`, start the gateway, and open the local workspace in the browser.

## Add your own skills

Drop a `.js` file into `./skills/` or `~/.caprigo/skills/`.

For agent playbooks that use `SKILL.md`, use `./skills/agentskills/`.

```javascript
module.exports = {
  name: 'my_skill',
  description: 'What it does',
  execute: async (params) => {
    return { success: true, result: 'done' };
  },
};
```

Restart the gateway after adding or changing local skills.

## Permissions

Caprigo writes a permissions file to:

```text
~/.caprigo/permissions.json
```

By default, approved scopes include:

- the Caprigo workspace root
- the Caprigo data root

If a file or shell action is denied, expand the approved scopes intentionally instead of disabling the whole safety layer.

## LLM guide

Caprigo automatically injects a workspace-level guide into LLM sessions before the model starts operating.

- Default file: `CAPRIGO_LLM_GUIDE.md`
- Workspace root: `CAPRIGO_WORKSPACE` if set, otherwise the gateway working directory
- Optional override: `CAPRIGO_LLM_GUIDE_PATH` or `CAPRIGO_PROGRAM_GUIDE_PATH`

Use this file to explain Caprigo itself to connected models.

## Project docs

- [INSTALL_AND_FIRST_RUN.md](INSTALL_AND_FIRST_RUN.md)
- [BETA_SMOKE_TEST.md](BETA_SMOKE_TEST.md)
- [CAPRIGO_LLM_GUIDE.md](CAPRIGO_LLM_GUIDE.md)
- [LANDING_PAGE_BRIEF.md](LANDING_PAGE_BRIEF.md)

## Status

Caprigo is being prepared for beta testing now.
