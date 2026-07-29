# Caprigo on AMD

**Credit:** b_Radford · Vibes-Coded · [caprigoai.com](https://caprigoai.com)

Caprigo is a local-first agent runtime (tools, MCP, missions, Board/Session). It talks to any OpenAI-compatible backend. On AMD scrap boxes today, that means **Ollama → Vulkan**.

## Lived proof (Polaris / RX 580)

Unsupported by modern ROCm. Still runs day-to-day coding agents:

| | |
|-|-|
| Path | Windows · Ollama · **Vulkan0** |
| Hardware | RX 580 8GB · Ryzen 5 2600 |
| Ballpark | 3B–7B Q4 ≈ **15–24 tok/s** · 7B@32k ≈ **19 tok/s** |

Writeup + CSVs + screenshots: [doteyeso-ops/rx580-vulkan-agents](https://github.com/doteyeso-ops/rx580-vulkan-agents)

## Operator notes for 8GB

- Prefer **3B–7B Q4**; full GPU offload (`num_gpu` high / `99`)
- Day-to-day agent ctx **8k–16k**; 32k works on 7B Q4 with care
- Avoid 9B Q6 + huge ctx (CPU spill / thrash)
- Flash attention + one model loaded at a time helps

## Target path (Lemonade / Halo / ROCm)

Same Caprigo agent loops on **supported** AMD:

1. Lemonade / Ryzen AI Halo (unified memory)
2. Radeon + ROCm (hackathon / Developer Cloud)
3. Publish scrap → supported delta (tok/s, ctx headroom, tool-loop stability)

## Env sketch

```bash
CAPRIGO_LLM_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
DEFAULT_MODEL=qwen2.5-coder:7b
# CAPRIGO_OLLAMA_NUM_GPU=99
```

On the Ollama host (Vulkan Polaris example):

```bat
set OLLAMA_FLASH_ATTENTION=1
set OLLAMA_MAX_LOADED_MODELS=1
ollama serve
```

— b_Radford
