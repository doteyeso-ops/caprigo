import React, { useEffect, useState } from 'react';
import type { HealthPayload, OptimizationProfile, RuntimePayload } from '../types';
import { OpenAiBaseExamplesList } from './OpenAiBaseExamplesList';
import { OPENAI_COMPATIBLE_BASE_EXAMPLES } from '../data/openaiCompatibleBaseExamples';
import { McpServersSettings } from './McpServersSettings';

interface Props {
  health: HealthPayload | null;
  runtime: RuntimePayload | null;
  onSaved: (r: RuntimePayload) => void;
  onStatusRefresh?: () => Promise<void>;
  /** Installed Ollama tags (from GET /api/ollama/models). */
  ollamaModels?: string[];
  onRefreshOllamaModels?: () => void;
  llmProvider?: string;
}

/** Must match `OPTIMIZATION_PRESETS` in @caprigo/shared (used for labels + local sync). */
const OPT_PRESETS: Record<'light' | 'balanced' | 'high', { maxTokens: number; ollamaNumCtx: number }> = {
  light: { maxTokens: 1024, ollamaNumCtx: 4096 },
  balanced: { maxTokens: 2048, ollamaNumCtx: 8192 },
  high: { maxTokens: 4096, ollamaNumCtx: 16384 },
};

const OPT_COPY: Record<OptimizationProfile, { title: string; blurb: string }> = {
  light: {
    title: 'Light',
    blurb: 'Easier on RAM and GPU — shorter memory and replies. Good for laptops or leaving Caprigo in the background.',
  },
  balanced: {
    title: 'Balanced',
    blurb: 'Default — solid quality on most PCs without pushing hardware.',
  },
  high: {
    title: 'High',
    blurb: 'Larger working memory and longer replies — for desktops with spare VRAM/RAM.',
  },
  custom: {
    title: 'Custom',
    blurb: 'Set max reply length and (for Ollama) context size yourself.',
  },
};

export function SettingsPanel({
  health,
  runtime,
  onSaved,
  onStatusRefresh,
  ollamaModels = [],
  onRefreshOllamaModels,
  llmProvider,
}: Props) {
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.5);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [ollamaNumCtx, setOllamaNumCtx] = useState(8192);
  const [optimizationProfile, setOptimizationProfile] = useState<OptimizationProfile>('balanced');
  const [laptopMode, setLaptopMode] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [connectionProvider, setConnectionProvider] = useState<'ollama' | 'openai_compatible'>('ollama');
  const [connectionPreset, setConnectionPreset] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [openaiBase, setOpenaiBase] = useState('https://api.openai.com/v1');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionSavedAt, setConnectionSavedAt] = useState<number | null>(null);
  const isOllama = llmProvider === 'ollama';
  const hasRemoteModelList = llmProvider === 'ollama' || llmProvider === 'openai_compatible';

  useEffect(() => {
    if (!runtime) return;
    const e = runtime.engine;
    setName(e.name);
    setModel(e.model);
    setTemperature(typeof e.temperature === 'number' ? e.temperature : 0.5);
    setMaxTokens(typeof e.maxTokens === 'number' ? e.maxTokens : 2048);
    setOllamaNumCtx(typeof e.ollamaNumCtx === 'number' ? e.ollamaNumCtx : 8192);
    setOptimizationProfile(e.optimizationProfile ?? 'balanced');
    setLaptopMode(!!e.laptopMode);
    setSystemPrompt(e.systemPrompt ?? '');
    if (runtime.llmConnection) {
      const c = runtime.llmConnection;
      setConnectionProvider(c.provider);
      setOllamaUrl(c.ollamaUrl || 'http://localhost:11434');
      setOpenaiBase(c.openaiBase || 'https://api.openai.com/v1');
      setOpenaiApiKey('');
      const matchedPreset = OPENAI_COMPATIBLE_BASE_EXAMPLES.find(
        ex => ex.url.toLowerCase() === (c.openaiBase || '').toLowerCase()
      );
      setConnectionPreset(matchedPreset?.url || '');
    }
  }, [runtime]);

  const setProfile = (p: OptimizationProfile) => {
    setOptimizationProfile(p);
    if (p === 'light' || p === 'balanced' || p === 'high') {
      const pr = OPT_PRESETS[p];
      setMaxTokens(pr.maxTokens);
      setOllamaNumCtx(pr.ollamaNumCtx);
    }
  };

  const applyLive = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!name.trim()) {
        setError('Display name cannot be empty');
        return;
      }
      if (!model.trim()) {
        setError('Model ID cannot be empty');
        return;
      }
      const body: Record<string, unknown> = {
        name: name.trim(),
        model: model.trim(),
        temperature,
        systemPrompt,
        laptopMode,
      };
      if (optimizationProfile === 'custom') {
        body.optimizationProfile = 'custom';
        body.maxTokens = Math.floor(maxTokens);
        if (isOllama) body.ollamaNumCtx = Math.floor(ollamaNumCtx);
      } else {
        body.optimizationProfile = optimizationProfile;
      }

      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : `Save failed (${res.status})`);
        return;
      }
      onSaved(data as RuntimePayload);
      setSavedAt(Date.now());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const saveConnection = async () => {
    setConnectionSaving(true);
    setConnectionError(null);
    try {
      const body: Record<string, unknown> = { provider: connectionProvider };
      if (connectionProvider === 'ollama') {
        try {
          new URL(ollamaUrl.trim());
        } catch {
          setConnectionError('Ollama URL must be a valid URL');
          return;
        }
        body.ollamaUrl = ollamaUrl.trim();
      } else {
        try {
          new URL(openaiBase.trim());
        } catch {
          setConnectionError('API base URL must be a valid URL');
          return;
        }
        body.openaiBase = openaiBase.trim();
        if (openaiApiKey.trim()) body.openaiApiKey = openaiApiKey.trim();
      }
      const res = await fetch('/api/llm-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConnectionError(typeof data.error === 'string' ? data.error : `Save failed (${res.status})`);
        return;
      }
      onSaved(data as RuntimePayload);
      setOpenaiApiKey('');
      setConnectionSavedAt(Date.now());
      if (onStatusRefresh) await onStatusRefresh();
      if (onRefreshOllamaModels) onRefreshOllamaModels();
    } catch (e: unknown) {
      setConnectionError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setConnectionSaving(false);
    }
  };

  const llm = health?.llm;
  const vibes = health?.vibes;

  const presetSummary =
    optimizationProfile === 'light' || optimizationProfile === 'balanced' || optimizationProfile === 'high'
      ? OPT_PRESETS[optimizationProfile]
      : { maxTokens, ollamaNumCtx };

  return (
    <div className="rb-settings">
      <div className="rb-settings__inner">
        <header className="rb-settings__head">
          <h1 className="rb-settings__title">Settings</h1>
          <p className="rb-settings__lede">
            These values apply to the running engine immediately.
          </p>
        </header>

        <section className="rb-settings__section">
          <h2 className="rb-settings__h">Connection</h2>
          <p className="rb-settings__opt-lede rb-muted">
            Configure LLM provider and API endpoint here. Ollama routes remain available for local models.
          </p>
          <div className="rb-settings__grid">
            <label className="rb-settings__field">
              <span className="rb-settings__label">Provider</span>
              <select
                className="rb-input"
                value={connectionProvider}
                onChange={e => setConnectionProvider(e.target.value as 'ollama' | 'openai_compatible')}
              >
                <option value="ollama">Ollama (local)</option>
                <option value="openai_compatible">OpenAI-compatible API</option>
              </select>
            </label>

            {connectionProvider === 'ollama' ? (
              <label className="rb-settings__field">
                <span className="rb-settings__label">Ollama URL</span>
                <input
                  className="rb-input rb-mono"
                  value={ollamaUrl}
                  onChange={e => setOllamaUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                />
              </label>
            ) : (
              <>
                <label className="rb-settings__field">
                  <span className="rb-settings__label">Known provider preset</span>
                  <select
                    className="rb-input"
                    value={connectionPreset}
                    onChange={e => {
                      const next = e.target.value;
                      setConnectionPreset(next);
                      if (next) setOpenaiBase(next);
                    }}
                  >
                    <option value="">Custom base URL…</option>
                    {OPENAI_COMPATIBLE_BASE_EXAMPLES.map(ex => (
                      <option key={ex.url} value={ex.url}>
                        {ex.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="rb-settings__field">
                  <span className="rb-settings__label">API base URL</span>
                  <input
                    className="rb-input rb-mono"
                    value={openaiBase}
                    onChange={e => {
                      const next = e.target.value;
                      setOpenaiBase(next);
                      const matched = OPENAI_COMPATIBLE_BASE_EXAMPLES.find(
                        ex => ex.url.toLowerCase() === next.trim().toLowerCase()
                      );
                      setConnectionPreset(matched?.url || '');
                    }}
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label className="rb-settings__field">
                  <span className="rb-settings__label">API key (leave blank to keep current)</span>
                  <input
                    type="password"
                    className="rb-input rb-mono"
                    value={openaiApiKey}
                    onChange={e => setOpenaiApiKey(e.target.value)}
                    placeholder="sk-..."
                    autoComplete="off"
                  />
                </label>
              </>
            )}
          </div>
          <div className="rb-settings__actions">
            <button type="button" className="rb-btn rb-btn--accent" disabled={connectionSaving} onClick={saveConnection}>
              {connectionSaving ? 'Saving…' : 'Save connection'}
            </button>
            {connectionSavedAt && !connectionError && (
              <span className="rb-settings__ok">Connection saved — provider updated live.</span>
            )}
            {connectionError && <span className="rb-settings__err">{connectionError}</span>}
          </div>
        </section>

        <section className="rb-settings__section">
          <h2 className="rb-settings__h">Laptop Mode</h2>
          <p className="rb-settings__opt-lede rb-muted">
            Optimize for laptops and low-end desktops: shorter replies, smaller context, and fewer tool-loop passes.
          </p>
          <label className="rb-settings__field">
            <span className="rb-settings__label">Enable laptop-first runtime profile</span>
            <input
              type="checkbox"
              checked={laptopMode}
              onChange={e => setLaptopMode(e.target.checked)}
            />
          </label>
        </section>

        <McpServersSettings runtime={runtime} onSaved={onSaved} />

        <section className="rb-settings__section">
          <h2 className="rb-settings__h">Optimization</h2>
          <p className="rb-settings__opt-lede rb-muted">
            Pick how hard Caprigo pushes your machine. Presets adjust reply length and (with Ollama) context memory — no
            need to know parameter names.
          </p>
          <fieldset className="rb-settings__opt-fieldset">
            <legend className="rb-sr-only">Resource usage preset</legend>
            <div className="rb-settings__opt-grid">
              {(['light', 'balanced', 'high', 'custom'] as const).map(id => (
                <label
                  key={id}
                  className={`rb-settings__opt-card ${optimizationProfile === id ? 'rb-settings__opt-card--on' : ''}`}
                >
                  <input
                    type="radio"
                    name="caprigo-optimization"
                    className="rb-settings__opt-radio"
                    checked={optimizationProfile === id}
                    onChange={() => setProfile(id)}
                  />
                  <span className="rb-settings__opt-card-title">{OPT_COPY[id].title}</span>
                  <span className="rb-settings__opt-card-blurb">{OPT_COPY[id].blurb}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {optimizationProfile === 'custom' ? (
            <div className="rb-settings__grid rb-settings__grid--opt-custom">
              <label className="rb-settings__field">
                <span className="rb-settings__label">Max tokens (reply length)</span>
                <input
                  type="number"
                  className="rb-input"
                  min={1}
                  max={200000}
                  value={maxTokens}
                  onChange={e => setMaxTokens(parseInt(e.target.value, 10) || 1)}
                />
              </label>
              {isOllama ? (
                <label className="rb-settings__field">
                  <span className="rb-settings__label">Context window (Ollama)</span>
                  <input
                    type="number"
                    className="rb-input"
                    min={512}
                    max={262144}
                    step={256}
                    value={ollamaNumCtx}
                    onChange={e => setOllamaNumCtx(parseInt(e.target.value, 10) || 512)}
                  />
                  <p className="rb-settings__model-hint rb-muted">
                    Larger values use more RAM/VRAM. If unsure, switch back to <strong>Balanced</strong>.
                  </p>
                </label>
              ) : (
                <p className="rb-settings__opt-api-note rb-muted">
                  Remote APIs use max tokens only; the provider manages context.
                </p>
              )}
            </div>
          ) : (
            <p className="rb-settings__opt-summary rb-muted">
              Active: up to <strong>{presetSummary.maxTokens.toLocaleString()}</strong> tokens per reply
              {isOllama && (
                <>
                  {' '}
                  · Ollama context <strong>{presetSummary.ollamaNumCtx.toLocaleString()}</strong> tokens
                </>
              )}
            </p>
          )}
        </section>

        <section className="rb-settings__section">
          <h2 className="rb-settings__h">Engine</h2>
          <div className="rb-settings__grid">
            <label className="rb-settings__field">
              <span className="rb-settings__label">Display name</span>
              <input className="rb-input" value={name} onChange={e => setName(e.target.value)} placeholder="Caprigo" />
            </label>
            <label className="rb-settings__field">
              <span className="rb-settings__label">
                Model ID
                {hasRemoteModelList && onRefreshOllamaModels && (
                  <button
                    type="button"
                    className="rb-btn rb-btn--ghost rb-settings__model-refresh"
                    title={
                      llmProvider === 'ollama'
                        ? 'Refresh list from Ollama'
                        : 'Refresh model list from the OpenAI-compatible API'
                    }
                    onClick={() => onRefreshOllamaModels()}
                  >
                    Refresh models
                  </button>
                )}
              </span>
              <input
                className="rb-input rb-mono"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder={llm?.provider === 'ollama' ? 'qwen3.5:latest' : 'gpt-4o-mini'}
                list={hasRemoteModelList && ollamaModels.length > 0 ? 'rb-settings-ollama-models' : undefined}
                autoComplete="off"
              />
              {hasRemoteModelList && ollamaModels.length > 0 && (
                <datalist id="rb-settings-ollama-models">
                  {ollamaModels.map(m => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
              {llmProvider === 'ollama' && (
                <p className="rb-settings__model-hint rb-muted">
                  List shows models reported by Ollama at <code className="rb-code">{llm?.ollama_url || '—'}</code> (
                  <code className="rb-code">ollama list</code> / manifests). Pick one or type any tag.
                </p>
              )}
              {llmProvider === 'openai_compatible' && (
                <p className="rb-settings__model-hint rb-muted">
                  List comes from <code className="rb-code">GET /v1/models</code> at{' '}
                  <code className="rb-code">{llm?.openai_base || '—'}</code>. Pick one or type any model id your
                  provider accepts.
                </p>
              )}
            </label>
            <label className="rb-settings__field">
              <span className="rb-settings__label">Temperature · {temperature.toFixed(2)}</span>
              <input
                type="range"
                className="rb-range"
                min={0}
                max={2}
                step={0.05}
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
              />
            </label>
          </div>
          <label className="rb-settings__field rb-settings__field--block">
            <span className="rb-settings__label">System prompt</span>
            <textarea
              className="rb-textarea rb-textarea--settings"
              rows={8}
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              placeholder="Instructions for every session…"
            />
          </label>
          <div className="rb-settings__actions">
            <button type="button" className="rb-btn rb-btn--accent" disabled={saving || !runtime} onClick={applyLive}>
              {saving ? 'Saving…' : 'Apply live'}
            </button>
            {savedAt && !error && (
              <span className="rb-settings__ok">Saved — next messages use this configuration.</span>
            )}
            {error && <span className="rb-settings__err">{error}</span>}
          </div>
        </section>

        <section className="rb-settings__section rb-settings__section--muted">
          <h2 className="rb-settings__h">Connection &amp; integrations</h2>
          {!llm && <p className="rb-muted">No health data — is the gateway running?</p>}
          {llm && (
            <dl className="rb-settings__dl">
              <dt>LLM provider</dt>
              <dd className="rb-mono">{llm.provider}</dd>
              {llm.provider === 'ollama' && (
                <>
                  <dt>Ollama URL</dt>
                  <dd>
                    <code className="rb-code">{llm.ollama_url}</code> · {llm.ollama === 'ok' ? 'reachable' : 'unreachable'}
                  </dd>
                </>
              )}
              {llm.provider === 'openai_compatible' && (
                <>
                  <dt>API base</dt>
                  <dd>
                    <code className="rb-code">{llm.openai_base}</code> · key {llm.openai_api_key_set ? 'set' : 'not set'}
                    {llm.openai !== 'ok' && llm.openai_probe_detail && (
                      <span className="rb-muted rb-settings__probe-err">
                        <br />
                        Probe:{' '}
                        {llm.openai_probe_http_status != null ? `HTTP ${llm.openai_probe_http_status} — ` : ''}
                        {llm.openai_probe_detail.slice(0, 200)}
                        {llm.openai_probe_detail.length > 200 ? '…' : ''}
                      </span>
                    )}
                  </dd>
                </>
              )}
            </dl>
          )}
          {vibes && (
            <p className="rb-settings__vibes">
              <span className="rb-muted">Vibes-Coded</span>{' '}
              <code className="rb-code">{vibes.api_base}</code> · key {vibes.api_key_set ? 'set' : 'not set'} · packs{' '}
              {vibes.local_packs_dir || '—'}
            </p>
          )}
          {runtime?.hostPlatform === 'win32' && (
            <div className="rb-settings__windows-mcp">
              <p className="rb-settings__windows-mcp-title">Windows desktop (MCP)</p>
              <p className="rb-muted">
                Add{' '}
                <a href="https://github.com/CursorTouch/Windows-MCP" target="_blank" rel="noreferrer">
                  Windows-MCP
                </a>{' '}
                in your MCP client (e.g. Cursor) for native UI automation, screenshots, apps, and shell—alongside
                Caprigo&apos;s built-in skills. Copy the example JSON from{' '}
                <code className="rb-code">integrations/windows-mcp/mcp-config.example.json</code> in this repo.
              </p>
            </div>
          )}
          <div className="rb-settings__base-examples">
            <p className="rb-muted rb-settings__base-examples-lede">
              Example <code className="rb-code">OPENAI_BASE_URL</code> values:
            </p>
            <OpenAiBaseExamplesList />
          </div>
          {runtime && (
            <p className="rb-settings__path">
              <span className="rb-muted">Skills</span> {runtime.skillCount} loaded from{' '}
              <code className="rb-code rb-code--break">{runtime.skillsDir}</code>
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
