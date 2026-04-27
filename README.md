# Caprigo

**Caprigo** is a local-first agent workspace built for people who want AI agents to operate on a real machine, against real files, with real tools, in a way that stays visible and controllable.

This is not another chat box with a thin tool wrapper.

Caprigo is the layer between:

- the model you connect
- the tools and skills you equip it with
- the scripts and files on your machine
- and the operational workspace where agents actually run

The public product home for the beta is **[caprigoai.com](https://caprigoai.com)**.

For the current beta, **[vibes-coded.com](https://vibes-coded.com)** is Caprigo's marketplace home. That is where Caprigo skills can be browsed, bought, sold, and imported into the runtime.

## Why Caprigo exists

Most AI products still break down into one of three categories:

- **chat-first assistants** that can answer questions but do not feel like operators
- **hosted agent wrappers** that feel abstracted away from the machine where the work actually lives
- **automation builders** that connect steps together but do not feel like persistent, adaptable workers

Caprigo is trying to land in a different place:

- persistent agents
- local execution
- assignable skills
- visible session state
- script support
- orchestrator and worker flows
- marketplace-connected expansion

The point is not to sound autonomous. The point is to be operable.

## What Caprigo actually is

- **Caprigo Core**: the runtime engine for agents, sessions, tools, orchestration, and gateway APIs
- **Caprigo CLI**: setup, diagnostics, chat, model checks, and agent operations from the terminal
- **Web workspace**: Overview, Board, Session, and Settings for live control
- **Skills system**: local skills, imported playbooks, MCP tools, marketplace installs, and offline scripts

## What makes it interesting

- **Local-first by default**: your agents work where your files, scripts, and tools already live
- **Model-agnostic**: run with Ollama locally or with an OpenAI-compatible backend
- **Persistent worker model**: sessions are not disposable prompts, they are named agents with purpose and history
- **Operational visibility**: inspect objectives, transcripts, scripts, orchestrator links, and runtime state
- **Skill marketplace path**: bring in packaged capabilities from `vibes-coded.com`
- **Expandable architecture**: add your own skills, MCP tools, and local scripts without rewriting the engine

## Skills in understandable language

Caprigo skills are the things an agent is allowed to do.

That includes:

- **Core file and system skills**: read files, write files, search folders, inspect the system, and run commands
- **HTTP and API skills**: talk to services and fetch external data
- **Offline scripts**: run local scripts without forcing every task through an LLM chat loop
- **Marketplace skills**: import packaged capabilities from `vibes-coded.com`
- **MCP tools**: connect external tool servers and expose them inside Caprigo
- **Playbook skills**: load `SKILL.md` instructions that teach agents repeatable workflows

This matters because Caprigo is not just trying to make one smart assistant.

It is trying to make agents that can be:

- equipped
- assigned
- inspected
- improved
- and reused

## Example use cases

### 1. Coding operator

Create one agent for implementation, one for code review, and one orchestrator that delegates between them.

The implementation agent can:

- inspect project files
- run build commands
- edit code
- report back through the shared workspace

The review agent can:

- read diffs
- inspect risky files
- call out regressions
- push findings back into the workflow

### 2. Research and execution desk

Use one agent to gather sources, one to summarize findings, and one to package the output into something publishable.

Instead of manually shuttling results between tabs, Caprigo keeps the agents in one operational workspace.

### 3. Local script runner

Some tasks do not need model reasoning at all. They need the right script, the right arguments, and the right output trail.

Caprigo supports that directly, so your workspace can mix:

- LLM-backed agents
- offline runtime modes
- repeatable script tasks

### 4. Skill builder and marketplace seller

If you build agent skills for resale or distribution, Caprigo gives you a place to:

- prototype skills locally
- test them against live agents
- import marketplace skills
- refine the playbooks and runtime behavior before release

## How Caprigo compares

Caprigo is not trying to win by pretending to be magic.

Compared with chat-first copilots:

- Caprigo is more operational
- more persistent
- more tool-and-workspace centric

Compared with hosted agent dashboards:

- Caprigo is closer to the machine
- easier to inspect
- better suited to local files, scripts, and custom tools

Compared with workflow automators:

- Caprigo is less rigid
- more agent-centric
- better suited to tasks that require judgment plus execution

Compared with early agent engines:

- Caprigo is aiming for a cleaner user boundary
- a stronger skill economy
- and a more usable operator workspace for day-to-day work

## Beta use cases we care about most

- software and automation agents working in real project folders
- research operators that gather, summarize, and hand off findings
- local script runners for repeatable operational tasks
- orchestrator and worker setups for multi-step jobs
- skill development, testing, packaging, and marketplace delivery

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

- the **user** sets up the runtime, model, permissions, and environment
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
