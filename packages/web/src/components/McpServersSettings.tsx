import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { RuntimePayload } from '../types';

type ApiServer = {
  id: string;
  enabled: boolean;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
};

type McpServerFormRow = {
  id: string;
  enabled: boolean;
  command: string;
  /** One CLI argument per line (empty lines ignored). */
  argsText: string;
  /** Optional env: one KEY=value per line. */
  envText: string;
  cwd: string;
};

function emptyRow(): McpServerFormRow {
  return {
    id: '',
    enabled: true,
    command: 'uvx',
    argsText: '',
    envText: '',
    cwd: '',
  };
}

function apiToRows(servers: ApiServer[]): McpServerFormRow[] {
  return servers.map(s => ({
    id: s.id,
    enabled: s.enabled !== false,
    command: s.command || '',
    argsText: (s.args || []).join('\n'),
    envText: s.env
      ? Object.entries(s.env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n')
      : '',
    cwd: s.cwd || '',
  }));
}

function parseArgs(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.trimEnd())
    .filter(l => l.length > 0);
}

function parseEnv(text: string): Record<string, string> | undefined {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return undefined;
  const env: Record<string, string> = {};
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k) env[k] = v;
  }
  return Object.keys(env).length ? env : undefined;
}

function rowsToApi(rows: McpServerFormRow[]): ApiServer[] {
  return rows.map(r => {
    const cwd = r.cwd.trim();
    return {
      id: r.id.trim(),
      enabled: r.enabled,
      command: r.command.trim(),
      args: parseArgs(r.argsText),
      env: parseEnv(r.envText),
      ...(cwd ? { cwd } : {}),
    };
  });
}

function validateRows(rows: McpServerFormRow[]): string | null {
  const ids = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = r.id.trim();
    if (!id) return `Server ${i + 1}: enter a short name (e.g. win).`;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/.test(id)) {
      return `Server "${id}": use letters, numbers, _ or - only (max 48 chars).`;
    }
    if (ids.has(id)) return `Duplicate name: ${id}`;
    ids.add(id);
    if (!r.command.trim()) return `Server "${id}": enter a command (e.g. uvx).`;
  }
  return null;
}

interface Props {
  runtime: RuntimePayload | null;
  onSaved: (r: RuntimePayload) => void;
}

type McpPreset = {
  key: 'filesystem' | 'github' | 'windows';
  title: string;
  blurb: string;
  baseId: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  windowsOnly?: boolean;
  requirement?: string;
};

function uniqueServerId(rows: McpServerFormRow[], baseId: string): string {
  const taken = new Set(rows.map(r => r.id.trim()).filter(Boolean));
  if (!taken.has(baseId)) return baseId;
  let n = 2;
  while (taken.has(`${baseId}${n}`)) n += 1;
  return `${baseId}${n}`;
}

export function McpServersSettings({ runtime, onSaved }: Props) {
  const [rows, setRows] = useState<McpServerFormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [jsonImport, setJsonImport] = useState('');

  const hostPlatform = runtime?.hostPlatform;
  const workspaceRoot = runtime?.workspaceRoot || '';

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch('/api/mcp-servers');
      if (!r.ok) throw new Error(`Could not load (${r.status})`);
      const d = (await r.json()) as { servers?: ApiServer[] };
      const list = Array.isArray(d.servers) ? d.servers : [];
      setRows(list.length ? apiToRows(list) : []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to load MCP config');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const previewJson = useMemo(() => {
    try {
      return JSON.stringify({ servers: rowsToApi(rows) }, null, 2);
    } catch {
      return '{}';
    }
  }, [rows]);

  const statusById = useMemo(() => {
    const m = new Map<string, { ok: boolean; toolCount: number; error?: string; enabled: boolean }>();
    for (const s of runtime?.mcp?.servers || []) {
      m.set(s.id, { ok: s.ok, toolCount: s.toolCount, error: s.error, enabled: s.enabled });
    }
    return m;
  }, [runtime?.mcp?.servers]);

  const recommendedPresets = useMemo<McpPreset[]>(() => {
    const presets: McpPreset[] = [
      {
        key: 'filesystem',
        title: 'Workspace filesystem',
        blurb: 'Give agents scoped file and directory tools for the current workspace through the official MCP filesystem server.',
        baseId: 'fs',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', workspaceRoot || '.'],
        cwd: workspaceRoot || '',
        requirement: workspaceRoot ? `Scoped to ${workspaceRoot}` : 'Uses the current gateway workspace',
      },
      {
        key: 'github',
        title: 'GitHub',
        blurb: 'Add official GitHub MCP tools for repository and PR operations without leaving Caprigo.',
        baseId: 'github',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
        requirement: 'Requires a GitHub personal access token',
      },
    ];
    if (hostPlatform === 'win32') {
      presets.push({
        key: 'windows',
        title: 'Windows desktop',
        blurb: 'Enable Windows UI automation, app control, screenshots, and desktop actions through Windows-MCP.',
        baseId: 'win',
        command: 'uvx',
        args: ['windows-mcp'],
        env: { ANONYMIZED_TELEMETRY: 'false' },
        windowsOnly: true,
        requirement: 'Requires uv / uvx on PATH',
      });
    }
    return presets;
  }, [hostPlatform, workspaceRoot]);

  const save = async () => {
    const v = validateRows(rows);
    if (v) {
      setErr(v);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payload = { servers: rowsToApi(rows) };
      const r = await fetch('/api/mcp-servers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(typeof data.error === 'string' ? data.error : `Save failed (${r.status})`);
        return;
      }
      onSaved(data as RuntimePayload);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const addRow = (preset?: Partial<McpServerFormRow>) => {
    setRows(prev => [...prev, { ...emptyRow(), ...preset }]);
    setErr(null);
  };

  const addPreset = (preset: McpPreset) => {
    addRow({
      id: uniqueServerId(rows, preset.baseId),
      enabled: true,
      command: preset.command,
      argsText: preset.args.join('\n'),
      envText: preset.env
        ? Object.entries(preset.env)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')
        : '',
      cwd: preset.cwd || '',
    });
  };

  const addWindowsMcp = () => {
    const preset = recommendedPresets.find(item => item.key === 'windows');
    if (!preset) return;
    addPreset(preset);
  };

  const removeRow = (index: number) => {
    setRows(prev => prev.filter((_, i) => i !== index));
    setErr(null);
  };

  const updateRow = (index: number, patch: Partial<McpServerFormRow>) => {
    setRows(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const applyJsonImport = () => {
    setErr(null);
    try {
      const parsed = JSON.parse(jsonImport) as { servers?: unknown[] };
      if (!parsed || !Array.isArray(parsed.servers)) {
        setErr('JSON must look like { "servers": [ … ] }');
        return;
      }
      const raw = parsed.servers as ApiServer[];
      const next: McpServerFormRow[] = raw.map(s => ({
        id: String(s.id ?? ''),
        enabled: s.enabled !== false,
        command: String(s.command ?? ''),
        argsText: Array.isArray(s.args) ? s.args.map(String).join('\n') : '',
        envText:
          s.env && typeof s.env === 'object'
            ? Object.entries(s.env as Record<string, string>)
                .map(([k, v]) => `${k}=${v}`)
                .join('\n')
            : '',
        cwd: typeof s.cwd === 'string' ? s.cwd : '',
      }));
      const ve = validateRows(next);
      if (ve) {
        setErr(ve);
        return;
      }
      setRows(next);
      setJsonImport('');
    } catch {
      setErr('Invalid JSON — check braces and quotes.');
    }
  };

  const copyPreview = async () => {
    try {
      await navigator.clipboard.writeText(previewJson);
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <section className="rb-settings__section">
        <h2 className="rb-settings__h">MCP tools</h2>
        <p className="rb-muted">Loading…</p>
      </section>
    );
  }

  return (
    <section className="rb-settings__section">
      <h2 className="rb-settings__h">MCP tools</h2>
      <p className="rb-settings__opt-lede rb-muted">
        Connect desktop and other apps that speak the{' '}
        <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer" className="rb-settings__inline-link">
          Model Context Protocol
        </a>{' '}
        (stdio). Each tool appears as <code className="rb-code">mcp_</code> + your server name + tool name. The gateway
        must find the command on its PATH (same as in a terminal). Set <code className="rb-code">CAPRIGO_DISABLE_MCP=1</code>{' '}
        on the server to turn this off entirely.
      </p>

      {runtime?.mcp?.configPath && (
        <p className="rb-muted rb-settings__path">
          <span className="rb-muted">Saved to</span>{' '}
          <code className="rb-code rb-code--break">{runtime.mcp.configPath}</code>
        </p>
      )}

      <div className="rb-mcp-presets">
        {recommendedPresets.map(preset => (
          <article key={preset.key} className="rb-mcp-preset">
            <div className="rb-mcp-preset__top">
              <strong className="rb-mcp-preset__title">{preset.title}</strong>
              {preset.windowsOnly && <span className="rb-mcp-preset__badge">Windows</span>}
            </div>
            <p className="rb-mcp-preset__blurb">{preset.blurb}</p>
            {preset.requirement && <p className="rb-mcp-preset__req">{preset.requirement}</p>}
            <button
              type="button"
              className="rb-btn rb-btn--ghost"
              onClick={() => addPreset(preset)}
              disabled={saving}
            >
              Add preset
            </button>
          </article>
        ))}
      </div>

      <div className="rb-mcp-toolbar">
        <button type="button" className="rb-btn rb-btn--accent" onClick={() => addRow()} disabled={saving}>
          + Add server
        </button>
        {hostPlatform === 'win32' && (
          <button type="button" className="rb-btn rb-btn--ghost" onClick={addWindowsMcp} disabled={saving}>
            + Windows-MCP (uvx)
          </button>
        )}
        <button type="button" className="rb-btn rb-btn--ghost" onClick={() => void load()} disabled={saving}>
          Reload from disk
        </button>
      </div>
      {hostPlatform !== 'win32' && (
        <p className="rb-muted rb-settings__hint rb-mcp-platform-hint">
          On Windows, a <strong>Windows-MCP (uvx)</strong> shortcut appears above for desktop automation.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rb-mcp-empty">
          <p className="rb-muted">
            No MCP servers configured. Start with one of the recommended presets above or add a custom server, then click{' '}
            <strong>Save &amp; connect</strong>.
          </p>
        </div>
      ) : (
        <ul className="rb-mcp-cards" aria-label="MCP servers">
          {rows.map((row, index) => {
            const st = statusById.get(row.id.trim());
            return (
              <li key={`${row.id}-${index}`} className="rb-mcp-card">
                <div className="rb-mcp-card__head">
                  <label className="rb-mcp-card__enable">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={e => updateRow(index, { enabled: e.target.checked })}
                    />
                    <span>On</span>
                  </label>
                  {st && (
                    <span
                      className={`rb-mcp-card__badge${st.enabled && st.ok ? ' rb-mcp-card__badge--ok' : ''}${st.enabled && !st.ok ? ' rb-mcp-card__badge--bad' : ''}`}
                      title={st.error || undefined}
                    >
                      {!st.enabled
                        ? 'Disabled'
                        : st.ok
                          ? `${st.toolCount} tools`
                          : st.error
                            ? 'Error'
                            : '—'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="rb-btn rb-btn--ghost rb-mcp-card__remove"
                    onClick={() => removeRow(index)}
                    aria-label={`Remove ${row.id || 'server'}`}
                  >
                    Remove
                  </button>
                </div>
                <div className="rb-settings__grid rb-mcp-card__grid">
                  <label className="rb-settings__field">
                    <span className="rb-settings__label">Short name</span>
                    <input
                      className="rb-input rb-mono"
                      value={row.id}
                      onChange={e => updateRow(index, { id: e.target.value })}
                      placeholder="e.g. win"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="rb-settings__hint">Used in tool names like mcp_yourname_ToolName</span>
                  </label>
                  <label className="rb-settings__field">
                    <span className="rb-settings__label">Command</span>
                    <input
                      className="rb-input rb-mono"
                      value={row.command}
                      onChange={e => updateRow(index, { command: e.target.value })}
                      placeholder="uvx"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <span className="rb-settings__hint">Executable (must be on PATH for the gateway)</span>
                  </label>
                </div>
                <label className="rb-settings__field rb-settings__field--block">
                  <span className="rb-settings__label">Arguments — one per line</span>
                  <textarea
                    className="rb-textarea rb-textarea--settings rb-mono"
                    rows={3}
                    value={row.argsText}
                    onChange={e => updateRow(index, { argsText: e.target.value })}
                    placeholder={'windows-mcp\n'}
                    spellCheck={false}
                  />
                </label>
                <label className="rb-settings__field rb-settings__field--block">
                  <span className="rb-settings__label">Working directory (optional)</span>
                  <input
                    className="rb-input rb-mono"
                    value={row.cwd}
                    onChange={e => updateRow(index, { cwd: e.target.value })}
                    placeholder="Leave empty for default"
                    spellCheck={false}
                  />
                </label>
                <label className="rb-settings__field rb-settings__field--block">
                  <span className="rb-settings__label">Environment (optional)</span>
                  <textarea
                    className="rb-textarea rb-textarea--settings rb-mono"
                    rows={2}
                    value={row.envText}
                    onChange={e => updateRow(index, { envText: e.target.value })}
                    placeholder={'ANONYMIZED_TELEMETRY=false'}
                    spellCheck={false}
                  />
                  <span className="rb-settings__hint">One KEY=value per line</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="rb-settings__actions rb-mcp-save">
        <button type="button" className="rb-btn rb-btn--accent" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save & connect'}
        </button>
        {err && <span className="rb-settings__err">{err}</span>}
      </div>

      <details className="rb-mcp-advanced">
        <summary className="rb-mcp-advanced__summary">Advanced — JSON import / export</summary>
        <p className="rb-muted rb-mcp-advanced__lede">
          Paste a full <code className="rb-code">{`{ "servers": […] }`}</code> payload to replace the form above, or copy
          the preview to back up your config.
        </p>
        <div className="rb-mcp-advanced__row">
          <label className="rb-settings__field rb-settings__field--block">
            <span className="rb-settings__label">Paste JSON to import</span>
            <textarea
              className="rb-textarea rb-textarea--settings rb-mono"
              rows={4}
              value={jsonImport}
              onChange={e => setJsonImport(e.target.value)}
              placeholder='{ "servers": [ { "id": "win", "enabled": true, "command": "uvx", "args": ["windows-mcp"] } ] }'
              spellCheck={false}
            />
          </label>
          <button type="button" className="rb-btn rb-btn--ghost" onClick={applyJsonImport} disabled={!jsonImport.trim()}>
            Replace form from JSON
          </button>
        </div>
        <label className="rb-settings__field rb-settings__field--block">
          <span className="rb-settings__label">Current config (read-only)</span>
          <textarea className="rb-textarea rb-textarea--settings rb-mono" rows={8} readOnly value={previewJson} spellCheck={false} />
        </label>
        <button type="button" className="rb-btn rb-btn--ghost" onClick={() => void copyPreview()}>
          Copy JSON to clipboard
        </button>
      </details>
    </section>
  );
}
