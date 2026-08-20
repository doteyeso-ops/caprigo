/**
 * Image generation skill — Hermes-style tool, not an LM Studio chat model.
 *
 * Providers (env CAPRIGO_IMAGE_PROVIDER):
 * - openai  → OpenAI-compatible POST {base}/images/generations
 * - a1111   → Automatic1111 / Forge  POST {base}/sdapi/v1/txt2img
 * - http    → Generic POST {base} with {prompt,...}; expects {b64_json|url|image}
 * - auto    → probe Forge hosts, then openai if key present
 *
 * RX 580 ≈8GB: SD 1.5 @ 512². Do not load Flux into LM Studio.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Skill, caprigoWorkspaceRoot, resolvePathUnderWorkspaceRoot } from '@caprigo/shared';

function provider(): string {
  return (process.env.CAPRIGO_IMAGE_PROVIDER || '').trim().toLowerCase() || 'auto';
}

/** Forge/A1111 bases only — never fall back to OPENAI_BASE_URL (that's the chat LLM). */
function forgeCandidateBases(): string[] {
  const list = [
    process.env.CAPRIGO_IMAGE_BASE_URL?.trim(),
    process.env.CAPRIGO_SD_URL?.trim(),
    'http://10.0.0.27:7860',
    'http://127.0.0.1:7860',
  ].filter(Boolean) as string[];
  return [...new Set(list.map(b => b.replace(/\/$/, '').replace(/\/v1$/i, '')))];
}

function openaiImageBase(): string {
  const raw =
    process.env.CAPRIGO_IMAGE_OPENAI_BASE?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    'https://api.openai.com';
  return raw.replace(/\/$/, '').replace(/\/v1$/i, '');
}

function apiKey(): string {
  return (
    process.env.CAPRIGO_IMAGE_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ''
  );
}

function defaultSteps(): number {
  const n = Number(process.env.CAPRIGO_IMAGE_STEPS || '15');
  return Number.isFinite(n) && n > 0 ? Math.min(50, Math.floor(n)) : 15;
}

function defaultSize(): number {
  const n = Number(process.env.CAPRIGO_IMAGE_SIZE || '512');
  return Number.isFinite(n) && n >= 256 ? Math.min(1024, Math.floor(n)) : 512;
}

function outDir(): string {
  const root = caprigoWorkspaceRoot();
  const dir = path.join(root, 'generated', 'images');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function slugName(prompt: string): string {
  const s = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return s || 'image';
}

function normalizeB64(raw: string): string {
  let s = String(raw || '').trim();
  const m = s.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (m) s = m[1];
  return s.replace(/\s+/g, '');
}

async function saveBase64Png(b64: string, prompt: string, explicitPath?: string): Promise<string> {
  const buf = Buffer.from(normalizeB64(b64), 'base64');
  if (buf.length < 64) throw new Error('decoded image too small — bad base64?');
  let dest: string;
  const root = caprigoWorkspaceRoot();
  if (explicitPath?.trim()) {
    const resolved = resolvePathUnderWorkspaceRoot(root, explicitPath.trim());
    if (!resolved) throw new Error(`path escapes workspace: ${explicitPath}`);
    dest = resolved;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } else {
    dest = path.join(outDir(), `${Date.now()}-${slugName(prompt)}.png`);
  }
  fs.writeFileSync(dest, buf);
  return dest;
}

async function saveFromUrl(url: string, prompt: string, explicitPath?: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download image ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let dest: string;
  const root = caprigoWorkspaceRoot();
  if (explicitPath?.trim()) {
    const resolved = resolvePathUnderWorkspaceRoot(root, explicitPath.trim());
    if (!resolved) throw new Error(`path escapes workspace: ${explicitPath}`);
    dest = resolved;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } else {
    const ext = url.includes('.jpg') || url.includes('jpeg') ? 'jpg' : 'png';
    dest = path.join(outDir(), `${Date.now()}-${slugName(prompt)}.${ext}`);
  }
  fs.writeFileSync(dest, buf);
  return dest;
}

type GenArgs = {
  prompt: string;
  negative_prompt?: string;
  path?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
};

type GenResult = {
  path: string;
  provider: string;
  base?: string;
  width: number;
  height: number;
  steps: number;
  elapsedMs: number;
};

async function genOpenAI(args: GenArgs): Promise<GenResult> {
  const started = Date.now();
  const root = openaiImageBase();
  const url = `${root}/v1/images/generations`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  const w = args.width || 1024;
  const h = args.height || 1024;

  const body: Record<string, unknown> = {
    prompt: args.prompt,
    n: 1,
    size: `${w}x${h}`,
    response_format: 'b64_json',
  };
  if (process.env.CAPRIGO_IMAGE_MODEL?.trim()) {
    body.model = process.env.CAPRIGO_IMAGE_MODEL.trim();
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`openai images ${res.status}: ${text.slice(0, 240)}`);
  const j = JSON.parse(text) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const row = j.data?.[0];
  let outPath: string;
  if (row?.b64_json) {
    outPath = await saveBase64Png(row.b64_json, args.prompt, args.path);
  } else if (row?.url) {
    outPath = await saveFromUrl(row.url, args.prompt, args.path);
  } else {
    throw new Error('openai images: no b64_json or url in response');
  }
  return {
    path: outPath,
    provider: 'openai',
    base: root,
    width: w,
    height: h,
    steps: 0,
    elapsedMs: Date.now() - started,
  };
}

async function genA1111(args: GenArgs, baseOverride?: string): Promise<GenResult> {
  const started = Date.now();
  const root = (baseOverride || forgeCandidateBases()[0] || 'http://10.0.0.27:7860').replace(
    /\/$/,
    ''
  );
  const url = `${root}/sdapi/v1/txt2img`;
  const w = args.width || defaultSize();
  const h = args.height || defaultSize();
  const steps = args.steps || defaultSteps();
  const body: Record<string, unknown> = {
    prompt: args.prompt,
    negative_prompt:
      args.negative_prompt ||
      process.env.CAPRIGO_IMAGE_NEGATIVE?.trim() ||
      'blurry, low quality, watermark, text, deformed',
    width: w,
    height: h,
    steps,
    cfg_scale: Number(process.env.CAPRIGO_IMAGE_CFG || '7') || 7,
    sampler_name: process.env.CAPRIGO_IMAGE_SAMPLER?.trim() || 'Euler a',
    batch_size: 1,
    n_iter: 1,
  };
  if (args.seed != null && Number.isFinite(Number(args.seed))) {
    body.seed = Math.floor(Number(args.seed));
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`a1111 ${res.status}: ${text.slice(0, 240)}`);
  let j: { images?: string[]; info?: string };
  try {
    j = JSON.parse(text) as { images?: string[]; info?: string };
  } catch {
    throw new Error(`a1111: invalid JSON (${text.slice(0, 120)})`);
  }
  const b64 = j.images?.[0];
  if (!b64) throw new Error('a1111: no images in response — is a checkpoint loaded?');
  const outPath = await saveBase64Png(b64, args.prompt, args.path);
  return {
    path: outPath,
    provider: 'a1111',
    base: root,
    width: w,
    height: h,
    steps,
    elapsedMs: Date.now() - started,
  };
}

async function genHttp(args: GenArgs): Promise<GenResult> {
  const started = Date.now();
  const url = process.env.CAPRIGO_IMAGE_BASE_URL?.trim();
  if (!url) throw new Error('CAPRIGO_IMAGE_BASE_URL required for http provider');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  const w = args.width || defaultSize();
  const h = args.height || defaultSize();
  const steps = args.steps || defaultSteps();
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: args.prompt,
      negative_prompt: args.negative_prompt,
      width: w,
      height: h,
      steps,
    }),
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`http image ${res.status}: ${text.slice(0, 240)}`);
  const j = JSON.parse(text) as {
    b64_json?: string;
    image?: string;
    url?: string;
    images?: string[];
  };
  const b64 = j.b64_json || j.image || j.images?.[0];
  let outPath: string;
  if (b64 && !/^https?:/i.test(b64)) {
    outPath = await saveBase64Png(b64, args.prompt, args.path);
  } else if (j.url) {
    outPath = await saveFromUrl(j.url, args.prompt, args.path);
  } else {
    throw new Error('http image: expected b64_json, image, images[], or url');
  }
  return {
    path: outPath,
    provider: 'http',
    base: url,
    width: w,
    height: h,
    steps,
    elapsedMs: Date.now() - started,
  };
}

async function probeA1111(base: string): Promise<{ ok: boolean; model?: string }> {
  try {
    const root = base.replace(/\/$/, '');
    const res = await fetch(`${root}/sdapi/v1/sd-models`, {
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return { ok: false };
    let model: string | undefined;
    try {
      const opts = await fetch(`${root}/sdapi/v1/options`, {
        signal: AbortSignal.timeout(3500),
      });
      if (opts.ok) {
        const j = (await opts.json()) as { sd_model_checkpoint?: string };
        model = j.sd_model_checkpoint;
      }
    } catch {
      /* ignore */
    }
    return { ok: true, model };
  } catch {
    return { ok: false };
  }
}

/** Quick readiness check for HUD / doctor (does not generate). */
export async function probeImageBackend(): Promise<{
  ok: boolean;
  provider: string;
  base?: string;
  detail: string;
  model?: string;
}> {
  const p = provider();
  if (p === 'openai') {
    if (apiKey()) {
      return {
        ok: true,
        provider: 'openai',
        base: openaiImageBase(),
        detail: 'OpenAI Images API key present',
      };
    }
    return { ok: false, provider: 'openai', detail: 'OPENAI_API_KEY / CAPRIGO_IMAGE_API_KEY missing' };
  }

  for (const base of forgeCandidateBases()) {
    const hit = await probeA1111(base);
    if (hit.ok) {
      return {
        ok: true,
        provider: 'a1111',
        base,
        model: hit.model,
        detail: hit.model ? `Forge ${base} · ${hit.model}` : `Forge/A1111 at ${base}`,
      };
    }
  }

  if (p === 'http' && process.env.CAPRIGO_IMAGE_BASE_URL?.trim()) {
    return {
      ok: true,
      provider: 'http',
      base: process.env.CAPRIGO_IMAGE_BASE_URL.trim(),
      detail: 'HTTP image endpoint configured (not probed)',
    };
  }

  if (apiKey()) {
    return {
      ok: true,
      provider: 'openai',
      base: openaiImageBase(),
      detail: 'API key present (openai path); Forge :7860 not reachable',
    };
  }

  return {
    ok: false,
    provider: p || 'auto',
    base: forgeCandidateBases()[0],
    detail:
      'No image API — start Forge on RX580 (:7860) or set OPENAI_API_KEY. CAPRIGO_IMAGE_BASE_URL=http://10.0.0.27:7860',
  };
}

async function detectAndGenerate(args: GenArgs): Promise<GenResult> {
  const p = provider();
  if (p === 'openai') return genOpenAI(args);
  if (p === 'http') return genHttp(args);

  if (p === 'a1111' || p === 'forge' || p === 'sd' || p === 'auto') {
    const errors: string[] = [];
    for (const base of forgeCandidateBases()) {
      const hit = await probeA1111(base);
      if (!hit.ok) {
        errors.push(`${base}: unreachable`);
        continue;
      }
      try {
        process.env.CAPRIGO_IMAGE_BASE_URL = base;
        return await genA1111(args, base);
      } catch (e) {
        errors.push(`${base}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (p !== 'auto') {
      throw new Error(
        [
          'Forge/A1111 not reachable.',
          ...errors.slice(0, 4),
          'On box: C:\\AI\\start-webui.cmd  (or scripts/bootstrap-forge-box.ps1)',
          'Laptop: CAPRIGO_IMAGE_PROVIDER=a1111 CAPRIGO_IMAGE_BASE_URL=http://10.0.0.27:7860',
        ].join('\n')
      );
    }
  }

  if (apiKey()) return genOpenAI(args);

  throw new Error(
    [
      'No image backend reachable.',
      'Image gen is a Caprigo skill (Hermes-style), not an LM Studio chat model.',
      'Start Forge on the RX580 box with --api on :7860, then:',
      '  CAPRIGO_IMAGE_PROVIDER=a1111',
      '  CAPRIGO_IMAGE_BASE_URL=http://10.0.0.27:7860',
    ].join('\n')
  );
}

export const generateImageSkill: Skill = {
  name: 'generate_image',
  description:
    'Generate an image from a text prompt and save it under generated/images/ (or path). Uses Forge/A1111 on the RX580 box (or OpenAI Images) — not the chat LLM. Call when the user asks to draw/create/generate an image or concept art.',
  toolParameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Text description of the image to generate' },
      negative_prompt: { type: 'string', description: 'Optional things to avoid' },
      path: { type: 'string', description: 'Optional output path under the workspace' },
      width: { type: 'number', description: 'Width in pixels (default 512 on Forge)' },
      height: { type: 'number', description: 'Height in pixels' },
      steps: { type: 'number', description: 'Diffusion steps (default 15 on Forge / RX580)' },
      seed: { type: 'number', description: 'Optional seed for reproducibility' },
    },
    required: ['prompt'],
  },
  execute: async (params: GenArgs) => {
    const prompt = String(params?.prompt || '').trim();
    if (!prompt) {
      return { success: false, error: 'prompt is required' };
    }
    try {
      const result = await detectAndGenerate({
        prompt,
        negative_prompt: params.negative_prompt,
        path: params.path,
        width: params.width,
        height: params.height,
        steps: params.steps,
        seed: params.seed,
      });
      return {
        success: true,
        path: result.path,
        provider: result.provider,
        base: result.base,
        width: result.width,
        height: result.height,
        steps: result.steps,
        elapsed_ms: result.elapsedMs,
        prompt,
        message: `Image saved to ${result.path} (${result.provider}, ${result.width}x${result.height}, ${result.steps} steps, ${(result.elapsedMs / 1000).toFixed(1)}s)`,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

export const imageSkills: Skill[] = [generateImageSkill];
