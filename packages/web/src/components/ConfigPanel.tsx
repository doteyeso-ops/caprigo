import React, { useState } from 'react';
import type { HealthPayload, RuntimePayload, SkillListItem } from '../types';
import { OpenAiBaseExamplesList } from './OpenAiBaseExamplesList';

interface Props {
  health: HealthPayload | null;
  runtime: RuntimePayload | null;
  skills: SkillListItem[];
  agentCount: number;
  onReloadSkills: () => Promise<void>;
}

const DEFAULT_SKILL_CODE = `/**
 * Local skill — \`name\` is the tool id the model will call.
 * Saved under your skills directory as <folder>/index.js
 */
module.exports = {
  name: 'my_skill',
  description: 'Describe what this tool does in one line.',
  execute: async (params) => {
    const q = params?.query ?? params?.text ?? '';
    return { success: true, echo: String(q) };
  },
};
`;

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`rb-config-dot${ok ? ' rb-config-dot--ok' : ' rb-config-dot--bad'}`} />;
}

export function ConfigPanel({ health, runtime, skills, agentCount, onReloadSkills }: Props) {
  const [logOpen, setLogOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [folder, setFolder] = useState('my_skill');
  const [code, setCode] = useState(DEFAULT_SKILL_CODE);
  const [saving, setSaving] = useState(false);
  const [skillMsg, setSkillMsg] = useState<string | null>(null);
  const [vibesQuery, setVibesQuery] = useState('');
  const [vibesHits, setVibesHits] = useState<Array<{ id: string; title?: string; description?: string }>>([]);
  const [vibesLoading, setVibesLoading] = useState(false);
  const [vibesErr, setVibesErr] = useState<string | null>(null);
  const [vibesInstallBusy, setVibesInstallBusy] = useState<string | null>(null);
  const [vibesInstallMsg, setVibesInstallMsg] = useState<string | null>(null);

  const llm = health?.llm;
  const vibes = health?.vibes;
  const provider = String(runtime?.llmProvider || llm?.provider || '').toLowerCase();

  const ollamaOk = llm?.provider === 'ollama' ? llm?.ollama === 'ok' : null;
  const openaiOk = llm?.provider === 'openai_compatible' ? llm?.openai === 'ok' : null;
  const backendReady =
    provider === 'ollama'
      ? llm?.ollama === 'ok'
      : provider === 'openai' || provider === 'openai_compatible'
        ? llm?.openai === 'ok'
        : false;
  const modelLabel = runtime?.engine.model?.trim() || '';
  const localSkillCount = skills.filter(s => s.source === 'user').length;
  const marketplaceSkillCount = skills.filter(s => s.source === 'marketplace').length;
  const setupChecklist = [
    {
      label: 'Backend connection',
      done: backendReady,
      detail: backendReady ? `${provider || 'backend'} reachable` : 'Connect and verify the selected provider',
    },
    {
      label: 'Default model',
      done: !!modelLabel,
      detail: modelLabel || 'Choose the model Caprigo should use by default',
    },
    {
      label: 'Skills and imports',
      done: skills.length > 0,
      detail:
        skills.length > 0
          ? `${skills.length} loaded (${localSkillCount} local, ${marketplaceSkillCount} marketplace)`
          : 'No tools loaded yet',
    },
    {
      label: 'First agent',
      done: agentCount > 0,
      detail: agentCount > 0 ? `${agentCount} created` : 'Create one focused agent from Overview',
    },
  ];

  const saveSkill = async () => {
    const f = folder.trim();
    if (!f || saving) return;
    setSaving(true);
    setSkillMsg(null);
    try {
      const r = await fetch('/api/user-skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: f, code }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSkillMsg(d?.error || `Save failed (${r.status})`);
        return;
      }
      setSkillMsg(`Saved — registered: ${(d.skills || []).map((x: { name: string }) => x.name).join(', ')}`);
      await onReloadSkills();
      setAddOpen(false);
    } catch (e) {
      setSkillMsg(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const skillsDir = runtime?.skillsDir;
  const localSkills = skills.filter(s => s.source === 'user');
  const marketplaceSkills = skills.filter(s => s.source === 'marketplace');
  const mcpSkills = skills.filter(s => s.source === 'mcp');
  const agentSkills = skills.filter(s => s.source === 'agentskill');
  const coreSkills = skills.filter(s => s.source === 'core');

  const searchVibesListings = async () => {
    setVibesLoading(true);
    setVibesErr(null);
    try {
      const q = vibesQuery.trim();
      const r = await fetch(
        `/api/vibes/listings?q=${encodeURIComponent(q)}&page_size=24`
      );
      const d = (await r.json()) as { listings?: typeof vibesHits; error?: string };
      if (!r.ok) throw new Error(d.error || `Search failed (${r.status})`);
      setVibesHits(d.listings || []);
    } catch (e) {
      setVibesErr(e instanceof Error ? e.message : String(e));
      setVibesHits([]);
    } finally {
      setVibesLoading(false);
    }
  };

  const installVibesListing = async (listingId: string) => {
    setVibesInstallBusy(listingId);
    setVibesInstallMsg(null);
    try {
      const r = await fetch('/api/vibes/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId }),
      });
      const d = (await r.json()) as { skills?: Array<{ name: string }>; error?: string };
      if (!r.ok) throw new Error(d.error || `Install failed (${r.status})`);
      setVibesInstallMsg(
        `Installed: ${(d.skills || []).map(x => x.name).join(', ')} — refresh agent skill pickers if open.`
      );
      await onReloadSkills();
    } catch (e) {
      setVibesInstallMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setVibesInstallBusy(null);
    }
  };

  return (
    <aside className="rb-config" aria-labelledby="config-heading">
      <h2 id="config-heading" className="rb-config__title">
        Runtime setup
      </h2>
      <p className="rb-config__lede">
        This page is for live runtime health, tool inventory, and marketplace imports. Use Settings for engine and LLM
        connection changes.
      </p>

      <div className="rb-config__card">
        <h3 className="rb-config__h">First launch order</h3>
        <ol className="rb-config__steps">
          {setupChecklist.map(item => (
            <li key={item.label} className="rb-config__step">
              <span className={`rb-config__step-badge ${item.done ? 'rb-config__step-badge--done' : 'rb-config__step-badge--todo'}`}>
                {item.done ? 'Done' : 'Next'}
              </span>
              <div className="rb-config__step-copy">
                <strong>{item.label}</strong>
                <span className="rb-muted">{item.detail}</span>
              </div>
            </li>
          ))}
        </ol>
        <p className="rb-hint rb-hint--tight">
          Caprigo setup is user-owned. Agent execution starts after runtime and model setup are confirmed.
        </p>
      </div>

      <div className="rb-config__card">
        <h3 className="rb-config__h">Engine</h3>
        {runtime ? (
          <dl className="rb-dl">
            {runtime.llmBadge && (
              <>
                <dt>LLM profile</dt>
                <dd>{runtime.llmBadge}</dd>
              </>
            )}
            <dt>Model</dt>
            <dd className="rb-mono">{runtime.engine.model}</dd>
            <dt>Engine ID</dt>
            <dd className="rb-mono">{runtime.engine.id}</dd>
            <dt>Temperature</dt>
            <dd>{runtime.engine.temperature ?? '—'}</dd>
            <dt>Optimization</dt>
            <dd>{runtime.engine.optimizationProfile ?? 'balanced'}</dd>
            <dt>Laptop mode</dt>
            <dd>{runtime.engine.laptopMode ? 'on' : 'off'}</dd>
            <dt>Max tokens</dt>
            <dd>{runtime.engine.maxTokens ?? '—'}</dd>
            {runtime.engine.ollamaNumCtx != null && (
              <>
                <dt>Ollama context</dt>
                <dd>{runtime.engine.ollamaNumCtx}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="rb-muted">Loading…</p>
        )}
      </div>

      <div className="rb-config__card">
        <h3 className="rb-config__h">LLM backend</h3>
        {!llm && <p className="rb-muted">No health data</p>}
        {llm && (
          <>
            {llm.badge && (
              <p className="rb-config__detail">
                <span className="rb-muted">Profile</span> {llm.badge}
              </p>
            )}
            <p className="rb-config__row">
              <StatusDot ok={ollamaOk !== false && openaiOk !== false} />
              <span className="rb-mono">{llm.provider}</span>
            </p>
            {llm.provider === 'ollama' && (
              <p className="rb-config__detail">
                <span className="rb-muted">URL</span> <code className="rb-code">{llm.ollama_url}</code>
                <br />
                <span className="rb-muted">Reachable</span>{' '}
                {llm.ollama === 'ok' ? 'yes' : llm.ollama === 'not reachable' ? 'no — start Ollama' : '—'}
              </p>
            )}
            {llm.provider === 'openai_compatible' && (
              <p className="rb-config__detail">
                <code className="rb-code">{llm.openai_base}</code>
                <br />
                API key set: {llm.openai_api_key_set ? 'yes' : 'no'} · API:{' '}
                {llm.openai === 'ok' ? 'reachable' : 'check network'}
                {llm.openai !== 'ok' && llm.openai_probe_detail && (
                  <>
                    <br />
                    <span className="rb-muted" title={llm.openai_probe_detail}>
                      {llm.openai_probe_http_status != null
                        ? `HTTP ${llm.openai_probe_http_status}`
                        : 'Error'}
                      : {llm.openai_probe_detail.slice(0, 120)}
                      {llm.openai_probe_detail.length > 120 ? '…' : ''}
                    </span>
                  </>
                )}
              </p>
            )}
            <p className="rb-hint rb-hint--tight">
              Provider/base/key can be changed in <strong>Settings → Connection</strong>. Env vars still work as startup defaults.
            </p>
            <p className="rb-config__detail rb-config__examples-lede">
              <span className="rb-muted">Example </span>
              <code className="rb-code">OPENAI_BASE_URL</code>
              <span className="rb-muted"> values (OpenAI-compatible providers):</span>
            </p>
            <OpenAiBaseExamplesList />
          </>
        )}
      </div>

      <div className="rb-config__card">
        <h3 className="rb-config__h">Vibes-Coded</h3>
        {!vibes && <p className="rb-muted">—</p>}
        {vibes && (
          <>
            <p className="rb-config__detail">
              <code className="rb-code">{vibes.api_base}</code>
            </p>
            <p className="rb-config__row">
              API key {vibes.api_key_set ? 'set' : 'not set'} · Local packs: {vibes.local_packs_dir || '—'}
            </p>
          </>
        )}
      </div>

      <div className="rb-config__card rb-config__card--vibes-import">
        <h3 className="rb-config__h">Vibes marketplace import</h3>
        <p className="rb-muted rb-config__detail">
          Search <strong>vibes-coded.com</strong> public listings, then install a Caprigo skill into your local{' '}
          <code className="rb-code">skills</code> folder. Paid or gated listings may need{' '}
          <code className="rb-code">VIBES_CODED_API_KEY</code> on the gateway.
        </p>
        <div className="rb-vibes-search">
          <input
            className="rb-input"
            placeholder="Search listings (e.g. crypto, json, memory)…"
            value={vibesQuery}
            onChange={e => setVibesQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void searchVibesListings()}
          />
          <button
            type="button"
            className="rb-btn rb-btn--accent"
            disabled={vibesLoading}
            onClick={() => void searchVibesListings()}
          >
            {vibesLoading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {vibesErr && <p className="rb-skill-add__err">{vibesErr}</p>}
        {vibesHits.length > 0 && (
          <ul className="rb-vibes-hits" aria-label="Search results">
            {vibesHits.map(h => (
              <li key={h.id} className="rb-vibes-hit">
                <div className="rb-vibes-hit__main">
                  <strong>{h.title || `Listing ${h.id}`}</strong>
                  <span className="rb-mono rb-muted">id {h.id}</span>
                  {h.description && <p className="rb-vibes-hit__desc">{h.description.slice(0, 220)}{h.description.length > 220 ? '…' : ''}</p>}
                </div>
                <button
                  type="button"
                  className="rb-btn rb-btn--ghost"
                  disabled={vibesInstallBusy === h.id}
                  onClick={() => void installVibesListing(h.id)}
                >
                  {vibesInstallBusy === h.id ? 'Installing…' : 'Install'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {vibesInstallMsg && (
          <p className={vibesInstallMsg.startsWith('Installed') ? 'rb-skill-add__ok' : 'rb-skill-add__err'}>{vibesInstallMsg}</p>
        )}
      </div>

      <div className="rb-config__card rb-config__card--skills">
        <h3 className="rb-config__h">Skills</h3>
        <p className="rb-config__skills-summary">
          <strong>{skills.length}</strong> tools registered
          {skillsDir && (
            <>
              {' '}
              · dir <code className="rb-code rb-code--break">{skillsDir}</code>
            </>
          )}
          <span className="rb-muted">
            {' '}
            · <strong>{localSkills.length}</strong> local · <strong>{marketplaceSkills.length}</strong> marketplace ·{' '}
            <strong>{mcpSkills.length}</strong> MCP · <strong>{agentSkills.length}</strong> agent skills ·{' '}
            <strong>{coreSkills.length}</strong> core
          </span>
        </p>
        <div className="rb-config__skills-actions">
          <button type="button" className="rb-btn rb-btn--ghost" onClick={() => setListOpen(o => !o)}>
            {listOpen ? 'Hide' : 'View'} skill list
          </button>
          <button type="button" className="rb-btn rb-btn--accent" onClick={() => setAddOpen(o => !o)}>
            {addOpen ? 'Close' : 'Add local skill'}
          </button>
          <button type="button" className="rb-btn rb-btn--ghost" onClick={() => void onReloadSkills()}>
            Refresh
          </button>
        </div>

        {listOpen && (
          <div className="rb-skill-list-wrap">
            <h4 className="rb-skill-list__heading">Local skills ({localSkills.length})</h4>
            <p className="rb-muted rb-skill-list__sub">
              Loaded from your <code className="rb-code">skills</code> directory (see path above). Refresh after adding
              files.
            </p>
            {localSkills.length === 0 ? (
              <p className="rb-muted rb-skill-list__empty">No user skills loaded — add folders with index.js or use Add local skill.</p>
            ) : (
              <ul className="rb-skill-list" aria-label="Local skills">
                {localSkills.map(s => (
                  <li key={s.name} className="rb-skill-list__item">
                    <span className={`rb-skill-src rb-skill-src--${s.source}`}>{s.source}</span>
                    <div className="rb-skill-list__body">
                      <strong className="rb-mono">{s.name}</strong>
                      <span className="rb-skill-list__desc">{s.description}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <h4 className="rb-skill-list__heading">Marketplace imports ({marketplaceSkills.length})</h4>
            {marketplaceSkills.length === 0 ? (
              <p className="rb-muted rb-skill-list__empty">None imported — use Vibes marketplace import above.</p>
            ) : (
              <ul className="rb-skill-list" aria-label="Marketplace skills">
                {marketplaceSkills.map(s => (
                  <li key={s.name} className="rb-skill-list__item">
                    <span className="rb-skill-src rb-skill-src--marketplace">marketplace</span>
                    <div className="rb-skill-list__body">
                      <strong className="rb-mono">{s.name}</strong>
                      <span className="rb-skill-list__desc">
                        {s.description}
                        {s.vibesListingId && (
                          <span className="rb-muted"> · listing {s.vibesListingId}</span>
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <h4 className="rb-skill-list__heading">Agent Skills (SKILL.md) ({agentSkills.length})</h4>
            {agentSkills.length === 0 ? (
              <p className="rb-muted rb-skill-list__empty">
                None — add folders with <code className="rb-code">SKILL.md</code> under{' '}
                <code className="rb-code">skills/agentskills/</code> (agentskills.io compatible).
              </p>
            ) : (
              <ul className="rb-skill-list" aria-label="Agent skills">
                {agentSkills.map(s => (
                  <li key={s.name} className="rb-skill-list__item">
                    <span className="rb-skill-src rb-skill-src--agentskill">agent skill</span>
                    <div className="rb-skill-list__body">
                      <strong className="rb-mono">{s.name}</strong>
                      <span className="rb-skill-list__desc">{s.description}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <h4 className="rb-skill-list__heading">MCP bridge ({mcpSkills.length})</h4>
            {mcpSkills.length === 0 ? (
              <p className="rb-muted rb-skill-list__empty">
                None — add MCP servers under <strong>Settings → MCP servers</strong> (stdio).
              </p>
            ) : (
              <ul className="rb-skill-list" aria-label="MCP skills">
                {mcpSkills.map(s => (
                  <li key={s.name} className="rb-skill-list__item">
                    <span className="rb-skill-src rb-skill-src--mcp">mcp</span>
                    <div className="rb-skill-list__body">
                      <strong className="rb-mono">{s.name}</strong>
                      <span className="rb-skill-list__desc">{s.description}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <h4 className="rb-skill-list__heading">Core engine skills ({coreSkills.length})</h4>
            <ul className="rb-skill-list" aria-label="Core skills">
              {coreSkills.map(s => (
                <li key={s.name} className="rb-skill-list__item">
                  <span className={`rb-skill-src rb-skill-src--${s.source}`}>{s.source}</span>
                  <div className="rb-skill-list__body">
                    <strong className="rb-mono">{s.name}</strong>
                    <span className="rb-skill-list__desc">{s.description}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {addOpen && (
          <div className="rb-skill-add">
            <p className="rb-muted rb-skill-add__hint">
              Creates <code className="rb-code">&lt;folder&gt;/index.js</code> under your skills directory and registers it immediately.
              Slug: letters, numbers, <code className="rb-code">_</code> <code className="rb-code">-</code> (max 48 chars). Set{' '}
              <code className="rb-code">CAPRIGO_DISABLE_SKILL_UPLOAD=true</code> on the gateway to block API saves.
            </p>
            <label className="rb-skill-add__label">
              Folder name
              <input
                className="rb-input"
                value={folder}
                onChange={e => setFolder(e.target.value)}
                placeholder="e.g. my_tool"
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="rb-skill-add__label">
              index.js
              <textarea
                className="rb-textarea rb-skill-add__code"
                value={code}
                onChange={e => setCode(e.target.value)}
                spellCheck={false}
              />
            </label>
            <div className="rb-skill-add__row">
              <button type="button" className="rb-btn rb-btn--accent" disabled={saving || !folder.trim()} onClick={() => void saveSkill()}>
                {saving ? 'Saving…' : 'Save & register'}
              </button>
              <button type="button" className="rb-btn rb-btn--ghost" onClick={() => setCode(DEFAULT_SKILL_CODE)}>
                Reset template
              </button>
            </div>
            {skillMsg && <p className={skillMsg.startsWith('Saved') ? 'rb-skill-add__ok' : 'rb-skill-add__err'}>{skillMsg}</p>}
          </div>
        )}
      </div>

      <div className="rb-config__card">
        <h3 className="rb-config__h">Execution log</h3>
        <p className="rb-muted">JSONL on disk + API</p>
        <button type="button" className="rb-btn rb-btn--ghost" onClick={() => setLogOpen(!logOpen)}>
          {logOpen ? 'Hide' : 'Peek'} recent entries
        </button>
        {logOpen && <ExecutionLogPeek />}
      </div>
    </aside>
  );
}

function ExecutionLogPeek() {
  const [entries, setEntries] = React.useState<Array<{ skill: string; ok: boolean; durationMs: number }>>([]);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch('/api/execution-log?limit=12')
      .then(r => r.json())
      .then(d => setEntries((d.entries || []).slice(-12)))
      .catch(() => setErr('Could not load'));
  }, []);

  if (err) return <p className="rb-muted">{err}</p>;
  if (entries.length === 0) return <p className="rb-muted">No entries yet.</p>;
  return (
    <ul className="rb-log-mini">
      {entries.map((e, i) => (
        <li key={i}>
          <span className={e.ok ? 'rb-log-ok' : 'rb-log-bad'}>{e.ok ? '✓' : '✗'}</span> {e.skill}{' '}
          <span className="rb-muted">({e.durationMs}ms)</span>
        </li>
      ))}
    </ul>
  );
}
