# Caprigo

[![visitors](https://myhits.vercel.app/api/hit/https%3A%2F%2Fgithub.com%2Fdoteyeso-ops%2Fcaprigo?color=blue&label=visitors&size=small)](https://myhits.vercel.app)
[![website](https://img.shields.io/badge/site-caprigoai.com-8B7355?style=flat)](https://caprigoai.com)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat)](LICENSE)

**Local-first agent workspace.** Connect your model once, launch persistent agents, and operate them across chat, tools, scripts, and multi-agent crews — on your machine, with full visibility.

| | |
|-|-|
| Product | [caprigoai.com](https://caprigoai.com) |
| Repo | https://github.com/doteyeso-ops/caprigo |
| Credit | **b_Radford** · Vibes-Coded |
| Marketplace | [vibes-coded.com](https://vibes-coded.com) |
| AMD lab | [rx580-vulkan-agents](https://github.com/doteyeso-ops/rx580-vulkan-agents) · [docs/AMD.md](docs/AMD.md) |

**8GB / scrap GPUs:** set `CAPRIGO_LEAN_TOOLS=1` so unrestricted agents send ~17 core tools instead of the full catalog. Assign skills when you need vibes / Agent Skills / MCP extras.

- **Caprigo Core** — gateway, agent loop, skills, sessions, orchestration APIs
- **Caprigo CLI** — `caprigo` for setup, doctor, chat, agents, skills
- **Caprigo Mesh** — agent networking (planned)

![Caprigo Board — orchestrator and worker crew on the operational canvas](docs/assets/board-crew.png)

## Demo (AMD)

[~72 second walkthrough](docs/demo/Caprigo_AMD_Demo.mp4) — Caprigo Overview / Session / Board on an RX 580 Vulkan lab baseline.

More: [docs/AMD.md](docs/AMD.md) · [rx580-vulkan-agents](https://github.com/doteyeso-ops/rx580-vulkan-agents)

## Why people use Caprigo

| You get | What it means |
|--------|----------------|
| Persistent agents | Named workers with objectives, history, and runtime state |
| Local execution | Files, shell, scripts, and tools on your machine |
| Model-agnostic backends | Ollama or OpenAI-compatible (LM Studio, OpenRouter, Groq, …) |
| Operational visibility | Trace exports, crew boards, orchestrator links |
| Expandable skills | Local JS, `SKILL.md`, MCP, marketplace imports |

## Screenshots

| Overview | Board (crew ops) |
|----------|------------------|
| ![Overview](docs/assets/overview.png) | ![Board](docs/assets/board-crew.png) |

Deep links: `/?tab=overview` · `/?tab=board` · `/?tab=session`

## Built-in workflow crews

- **Repo Crew** — scout + operator under a lead
- **Automation Crew** — script runner + ops reporter
- **Launch Audit Crew** — surface + risk reviewers
- **PR Review Crew** — diff scout + risk reviewer

## Quick start

```bash
git clone https://github.com/doteyeso-ops/caprigo.git
cd caprigo
cp .env.example .env
npm install
npm run build
npm run build:web
npm run start
```

Open **http://127.0.0.1:18789**.

**Windows:** `.\setup.ps1` · daily: `.\launch.ps1`

```bash
caprigo setup --interactive
caprigo doctor
```

See [INSTALL_AND_FIRST_RUN.md](INSTALL_AND_FIRST_RUN.md) and [SOCIAL_LAUNCH.md](SOCIAL_LAUNCH.md) for beta install + launch copy.

## Project docs

- [INSTALL_AND_FIRST_RUN.md](INSTALL_AND_FIRST_RUN.md)
- [SOCIAL_LAUNCH.md](SOCIAL_LAUNCH.md)
- [BETA_SMOKE_TEST.md](BETA_SMOKE_TEST.md)
- [docs/AMD.md](docs/AMD.md)

## Status

Caprigo is in **beta**. Stars welcome; issues with repro steps help more.

## License

MIT — see [LICENSE](LICENSE).
