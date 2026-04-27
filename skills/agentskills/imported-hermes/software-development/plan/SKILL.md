---
name: plan
description: Plan mode for Hermes — inspect context, write a markdown plan into the active workspace's `.hermes/plans/` directory, and do not execute the work.
version: 1.0.0
author: Hermes Agent
license: MIT
metadata:
  hermes:
    tags: [planning, plan-mode, implementation, workflow]
    related_skills: [writing-plans, subagent-driven-development]
---

# Plan Mode

Use this skill when the user wants a plan instead of execution.

## Core behavior

For this turn, you are planning only.

- Do not implement code.
- Do not edit project files except the plan markdown file.
- Do not run mutating terminal commands, commit, push, or perform external actions.
- You may inspect the repo or other context with read-only commands/tools when needed.
- Your deliverable is a markdown plan saved inside the active workspace under `.hermes/plans/`.

## Output requirements

Write a markdown plan that is concrete and actionable.

Include, when relevant:
- Goal
- Current context / assumptions
- Proposed approach
- Step-by-step plan
- Files likely to change
- Tests / validation
- Risks, tradeoffs, and open questions

If the task is code-related, include exact file paths, likely test targets, and verification steps.

## Save location

Save the plan with `write_file` under:
- `.hermes/plans/YYYY-MM-DD_HHMMSS-<slug>.md`

Treat that as relative to the active working directory / backend workspace. Hermes file tools are backend-aware, so using this relative path keeps the plan with the workspace on local, docker, ssh, modal, and daytona backends.

If the runtime provides a specific target path, use that exact path.
If not, create a sensible timestamped filename yourself under `.hermes/plans/`.

## Interaction style

- If the request is clear enough, write the plan directly.
- If no explicit instruction accompanies `/plan`, infer the task from the current conversation context.
- If it is genuinely underspecified, ask a brief clarifying question instead of guessing.
- After saving the plan, reply briefly with what you planned and the saved path.

## Caprigo playbook (extended)

- **Plan directory:** Keep **`.hermes/plans/`** for compatibility with upstream docs, or prefer **`.caprigo/plans/`** in Caprigo-only workspaces — both are fine as long as the path is **under the active workspace** Caprigo exposes to file tools.
- **Tools:** Use **`write_file`** (and read-only **`read_file`**, **`list_directory`**, **`search_files`**) as described above; Caprigo’s backend resolves paths relative to the configured workspace root.
- **Still no execution in plan mode:** Do not use **`execute_command`** for mutating steps during a strict `/plan` turn unless the user explicitly widens scope.

---

## Caprigo Core (adaptation)

This playbook targets [Hermes Agent](https://github.com/NousResearch/hermes-agent). In **Caprigo Core**, map steps as follows:

- **Shell** → Caprigo tool `execute_command` (optional `cwd`).
- **HTTP / APIs** → `http_request` or curl via `execute_command`.
- **Repo files** → filesystem tools such as `read_file`, `list_directory`, `search_files`.
- **MCP** (optional) → tools named `mcp_*` from **Settings → MCP servers**.
- **Hermes-only helpers** (e.g. web_extract) → use HTTP + parsing or install upstream CLIs if required.

Cheatsheet: `skills/agentskills/imported-hermes/CAPRIGO.md`.
