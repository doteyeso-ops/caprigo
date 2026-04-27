import React, { useEffect, useMemo, useState } from 'react';
import type { AgentCardModel, LocalScriptItem, SessionPatchPayload, SkillListItem } from '../types';
import { ModelPicker } from './ModelPicker';

type AgentStarterTemplate = {
  id: string;
  label: string;
  blurb: string;
  displayName: string;
  description: string;
  objective: string;
  runtimeMode: 'llm' | 'offline';
  agentRole: 'agent' | 'orchestrator';
};

const STARTER_TEMPLATES: AgentStarterTemplate[] = [
  {
    id: 'coder',
    label: 'Coder',
    blurb: 'For code changes, shell work, and file-based tasks.',
    displayName: 'Code Operator',
    description: 'Local coding and implementation agent',
    objective: 'Finish the requested code task end-to-end, verify the result, and report changed files or blockers clearly.',
    runtimeMode: 'llm',
    agentRole: 'agent',
  },
  {
    id: 'research',
    label: 'Research',
    blurb: 'For source gathering, synthesis, and structured findings.',
    displayName: 'Research Operator',
    description: 'Research and synthesis agent',
    objective: 'Gather the necessary evidence, compare options, and return a concise answer with the strongest supporting facts.',
    runtimeMode: 'llm',
    agentRole: 'agent',
  },
  {
    id: 'orchestrator',
    label: 'Orchestrator',
    blurb: 'For coordinating worker agents across a multi-step flow.',
    displayName: 'Fleet Coordinator',
    description: 'Coordinates linked worker agents',
    objective: 'Break the mission into clear work assignments, track worker progress, and keep the user updated on status and blockers.',
    runtimeMode: 'llm',
    agentRole: 'orchestrator',
  },
  {
    id: 'script-runner',
    label: 'Script Runner',
    blurb: 'For repeatable local scripts without an active chat model.',
    displayName: 'Local Script Runner',
    description: 'Offline script execution agent',
    objective: 'Run the assigned local script, capture the result, and surface any failure output clearly.',
    runtimeMode: 'offline',
    agentRole: 'agent',
  },
];

interface Props {
  open: boolean;
  mode: 'create' | 'edit';
  agent: AgentCardModel | null;
  catalog: SkillListItem[];
  localScripts: LocalScriptItem[];
  scriptsDir: string | null;
  /** Sessions that are orchestrators (for link dropdown). */
  orchestrators: AgentCardModel[];
  /** Gateway workspace root (for instruction file paths). */
  workspaceRoot: string | null;
  engineModel: string;
  llmProvider?: string;
  ollamaModels: string[];
  onRefreshOllamaModels: () => void;
  onClose: () => void;
  /** Create: POST body fields; edit: PATCH payload */
  onCreate: (body: Record<string, unknown>) => Promise<{ id: string } | null>;
  onPatch: (sessionId: string, patch: SessionPatchPayload) => Promise<void>;
  /** After a successful create (e.g. jump to Board). */
  onCreated?: () => void;
}

export function AgentBuilderDialog({
  open,
  mode,
  agent,
  catalog,
  localScripts,
  scriptsDir,
  orchestrators,
  workspaceRoot,
  engineModel,
  llmProvider,
  ollamaModels,
  onRefreshOllamaModels,
  onClose,
  onCreate,
  onPatch,
  onCreated,
}: Props) {
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [objective, setObjective] = useState('');
  const [agentInstructionsPath, setAgentInstructionsPath] = useState('');
  const [runtimeMode, setRuntimeMode] = useState<'llm' | 'offline'>('llm');
  const [agentRole, setAgentRole] = useState<'agent' | 'orchestrator'>('agent');
  const [linkedOrchId, setLinkedOrchId] = useState('');
  const [useAllSkills, setUseAllSkills] = useState(true);
  const [pickedSkills, setPickedSkills] = useState<Set<string>>(() => new Set());
  const [primaryScriptId, setPrimaryScriptId] = useState('');
  const [skillSearch, setSkillSearch] = useState('');
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const applyTemplate = (template: AgentStarterTemplate) => {
    setDisplayName(template.displayName);
    setDescription(template.description);
    setObjective(template.objective);
    setRuntimeMode(template.runtimeMode);
    setAgentRole(template.agentRole);
    setLinkedOrchId('');
    setUseAllSkills(true);
    setPickedSkills(new Set());
    setSessionModel(null);
    if (template.runtimeMode === 'llm') {
      setPrimaryScriptId('');
    }
  };

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setSkillSearch('');
    if (mode === 'edit' && agent) {
      setDisplayName(agent.displayName || '');
      setDescription(agent.description ?? '');
      setObjective(agent.objective ?? '');
      setAgentInstructionsPath(agent.agentInstructionsPath ?? '');
      setRuntimeMode(agent.runtimeMode === 'offline' ? 'offline' : 'llm');
      setAgentRole(agent.agentRole === 'orchestrator' ? 'orchestrator' : 'agent');
      setLinkedOrchId(agent.linkedOrchestratorId ?? '');
      const has = !!(agent.assignedSkills && agent.assignedSkills.length);
      setUseAllSkills(!has);
      setPickedSkills(has ? new Set(agent.assignedSkills!) : new Set());
      setPrimaryScriptId(agent.primaryOfflineScriptId ?? '');
      setSessionModel(agent.model ?? null);
    } else {
      setDisplayName('');
      setDescription('');
      setObjective('');
      setAgentInstructionsPath('');
      setRuntimeMode('llm');
      setAgentRole('agent');
      setLinkedOrchId('');
      setUseAllSkills(true);
      setPickedSkills(new Set());
      setPrimaryScriptId('');
      setSessionModel(null);
    }
  }, [open, mode, agent]);

  const filteredCatalog = useMemo(() => {
    const q = skillSearch.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q)
    );
  }, [catalog, skillSearch]);

  const coreSkills = useMemo(() => filteredCatalog.filter(s => s.source === 'core'), [filteredCatalog]);
  const userSkills = useMemo(() => filteredCatalog.filter(s => s.source === 'user'), [filteredCatalog]);
  const marketplaceSkills = useMemo(
    () => filteredCatalog.filter(s => s.source === 'marketplace'),
    [filteredCatalog]
  );
  const mcpSkills = useMemo(() => filteredCatalog.filter(s => s.source === 'mcp'), [filteredCatalog]);
  const agentSkills = useMemo(() => filteredCatalog.filter(s => s.source === 'agentskill'), [filteredCatalog]);

  const toggleSkill = (name: string) => {
    setPickedSkills(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const save = async () => {
    const name = displayName.trim();
    if (!name) {
      setErr('Agent name is required.');
      return;
    }
    if (!useAllSkills && pickedSkills.size === 0) {
      setErr('Choose at least one skill, or turn on “Use all registered skills”.');
      return;
    }
    if (runtimeMode === 'offline' && localScripts.length > 0 && !primaryScriptId.trim()) {
      setErr('Choose an offline script, or add scripts under your offline-scripts folder first.');
      return;
    }

    setSaving(true);
    setErr(null);
    try {
      const assignedSkills = useAllSkills ? [] : [...pickedSkills];
      if (mode === 'create') {
        const body: Record<string, unknown> = {
          displayName: name,
          runtimeMode,
          agentRole,
        };
        if (description.trim()) body.description = description.trim();
        if (objective.trim()) body.objective = objective.trim();
        if (agentInstructionsPath.trim()) body.agentInstructionsPath = agentInstructionsPath.trim();
        if (assignedSkills.length) body.assignedSkills = assignedSkills;
        if (agentRole === 'agent' && linkedOrchId) {
          body.linkedOrchestratorId = linkedOrchId;
        }
        if (runtimeMode === 'offline' && primaryScriptId) {
          body.primaryOfflineScriptId = primaryScriptId;
          body.assignedOfflineScripts = [primaryScriptId];
        }
        if (runtimeMode === 'llm' && sessionModel) {
          body.model = sessionModel;
        }
        const created = await onCreate(body);
        if (!created?.id) setErr('Could not create agent.');
        else {
          onCreated?.();
          onClose();
        }
      } else if (agent) {
        const patch: SessionPatchPayload = {
          displayName: name,
          description: description.trim() || null,
          objective: objective.trim() || null,
          runtimeMode,
          agentRole,
          linkedOrchestratorId: agentRole === 'agent' ? (linkedOrchId || null) : null,
          assignedSkills,
        };
        if (runtimeMode === 'offline') {
          patch.primaryOfflineScriptId = primaryScriptId || null;
          if (primaryScriptId) {
            patch.assignedOfflineScripts = [primaryScriptId];
          }
        } else {
          patch.primaryOfflineScriptId = null;
        }
        if (runtimeMode === 'llm') {
          patch.model = sessionModel;
        } else {
          patch.model = null;
        }
        await onPatch(agent.id, patch);
        onClose();
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="rb-dialog-root" role="presentation" onClick={onClose}>
      <div
        className="rb-dialog rb-dialog--wide rb-dialog--builder"
        role="dialog"
        aria-labelledby="agent-builder-title"
        onClick={e => e.stopPropagation()}
      >
        <header className="rb-dialog__head">
          <h2 id="agent-builder-title" className="rb-dialog__title">
            {mode === 'create' ? 'Create agent' : 'Edit agent'}
          </h2>
          <button type="button" className="rb-icon-btn" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="rb-builder__body">
          {mode === 'create' && (
            <section className="rb-builder__section">
              <h3 className="rb-builder__h">Starter templates</h3>
              <p className="rb-muted rb-builder__hint rb-builder__hint--top">
                Start from a proven role, then adjust the objective, tools, and runtime.
              </p>
              <div className="rb-builder__templates">
                {STARTER_TEMPLATES.map(template => (
                  <button
                    key={template.id}
                    type="button"
                    className="rb-builder__template"
                    onClick={() => applyTemplate(template)}
                  >
                    <strong className="rb-builder__template-title">{template.label}</strong>
                    <span className="rb-builder__template-meta">
                      {template.runtimeMode === 'llm' ? 'LLM' : 'Offline'} ·{' '}
                      {template.agentRole === 'orchestrator' ? 'Orchestrator' : 'Agent'}
                    </span>
                    <span className="rb-builder__template-blurb">{template.blurb}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="rb-builder__section">
            <h3 className="rb-builder__h">Basic info</h3>
            <label className="rb-builder__field">
              <span>Agent name *</span>
              <input
                className="rb-input"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="e.g. Research assistant"
                autoComplete="off"
              />
            </label>
            <label className="rb-builder__field">
              <span>Description</span>
              <input
                className="rb-input"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="One-line summary of what this agent owns"
              />
            </label>
            <label className="rb-builder__field">
              <span>Objective (essential outcome)</span>
              <textarea
                className="rb-textarea rb-builder__textarea"
                value={objective}
                onChange={e => setObjective(e.target.value)}
                placeholder="Define done in one sentence: the outcome this agent should finish or prove."
                rows={3}
              />
            </label>
            <label className="rb-builder__field">
              <span>Instruction file (.md)</span>
              <input
                className="rb-input"
                value={agentInstructionsPath}
                onChange={e => setAgentInstructionsPath(e.target.value)}
                placeholder="e.g. docs/agents/researcher.md"
                autoComplete="off"
              />
              <p className="rb-muted rb-builder__hint">
                Relative path from the gateway workspace{workspaceRoot ? (
                  <>
                    : <code className="rb-code rb-code--break">{workspaceRoot}</code>
                  </>
                ) : (
                  ' (set CAPRIGO_WORKSPACE or start the gateway from your project root)'
                )}
                . Contents are added to this agent&apos;s <strong>LLM</strong> system prompt when chat runs. Leave empty
                to disable.
              </p>
            </label>
            <div className="rb-builder__field rb-builder__inline">
              <span>Fleet role</span>
              <div className="rb-builder__seg">
                <button
                  type="button"
                  className={`rb-btn${agentRole === 'agent' ? ' rb-btn--accent' : ''}`}
                  onClick={() => setAgentRole('agent')}
                >
                  Agent
                </button>
                <button
                  type="button"
                  className={`rb-btn${agentRole === 'orchestrator' ? ' rb-btn--accent' : ''}`}
                  onClick={() => {
                    setAgentRole('orchestrator');
                    setLinkedOrchId('');
                  }}
                >
                  Orchestrator
                </button>
              </div>
            </div>
            {agentRole === 'agent' && orchestrators.length > 0 && (
              <label className="rb-builder__field">
                <span>Report to orchestrator (optional)</span>
                <select
                  className="rb-input"
                  value={linkedOrchId}
                  onChange={e => setLinkedOrchId(e.target.value)}
                >
                  <option value="">— none —</option>
                  {orchestrators.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.displayName} ({o.id.slice(0, 8)}…)
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

          <section className="rb-builder__section">
            <h3 className="rb-builder__h">Runtime mode</h3>
            <div className="rb-builder__seg rb-builder__seg--lg">
              <button
                type="button"
                className={`rb-btn${runtimeMode === 'llm' ? ' rb-btn--accent' : ''}`}
                onClick={() => setRuntimeMode('llm')}
              >
                LLM (chat + tools)
              </button>
              <button
                type="button"
                className={`rb-btn${runtimeMode === 'offline' ? ' rb-btn--accent rb-btn--offline' : ''}`}
                onClick={() => setRuntimeMode('offline')}
              >
                Offline / Local (scripts)
              </button>
            </div>
            <p className="rb-muted rb-builder__hint">
              {runtimeMode === 'llm'
                ? 'Uses the configured server model in Session view (per-agent override below). Skills are exposed as tools.'
                : 'No live Session chat for this agent. Run disk scripts from the Board. Skills stay on the server but are not invoked until you switch back to LLM.'}
            </p>
          </section>

          {runtimeMode === 'llm' && (
            <section className="rb-builder__section">
              <h3 className="rb-builder__h">Model</h3>
              <ModelPicker
                value={sessionModel}
                onChange={setSessionModel}
                engineModel={engineModel}
                llmProvider={llmProvider || ''}
                ollamaModels={ollamaModels}
                onRefreshModels={onRefreshOllamaModels}
              />
            </section>
          )}

          {runtimeMode === 'llm' && (
            <section className="rb-builder__section">
              <h3 className="rb-builder__h">LLM tools (skills)</h3>
              <label className="rb-builder__check">
                <input
                  type="checkbox"
                  checked={useAllSkills}
                  onChange={e => {
                    setUseAllSkills(e.target.checked);
                    if (e.target.checked) setPickedSkills(new Set());
                  }}
                />
                <span>
                  Use all registered skills ({catalog.length})
                </span>
              </label>
              {!useAllSkills && (
                <>
                  <input
                    className="rb-input rb-builder__search"
                    placeholder="Search skills…"
                    value={skillSearch}
                    onChange={e => setSkillSearch(e.target.value)}
                  />
                  <div className="rb-builder__skill-groups">
                    <div>
                      <h4 className="rb-builder__subh">Core</h4>
                      <div className="rb-dialog__skill-grid rb-builder__skill-grid">
                        {coreSkills.length === 0 ? (
                          <p className="rb-muted">No matches.</p>
                        ) : (
                          coreSkills.map(s => (
                            <label key={s.name} className="rb-dialog__skill-item">
                              <input
                                type="checkbox"
                                checked={pickedSkills.has(s.name)}
                                onChange={() => toggleSkill(s.name)}
                              />
                              <span>
                                <strong className="rb-mono">{s.name}</strong>
                                <span className="rb-skill-src rb-skill-src--core">core</span>
                                <span className="rb-dialog__skill-desc">{s.description}</span>
                              </span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <h4 className="rb-builder__subh">Local</h4>
                      <div className="rb-dialog__skill-grid rb-builder__skill-grid">
                        {userSkills.length === 0 ? (
                          <p className="rb-muted">No user skills — add folders under your skills directory.</p>
                        ) : (
                          userSkills.map(s => (
                            <label key={s.name} className="rb-dialog__skill-item">
                              <input
                                type="checkbox"
                                checked={pickedSkills.has(s.name)}
                                onChange={() => toggleSkill(s.name)}
                              />
                              <span>
                                <strong className="rb-mono">{s.name}</strong>
                                <span className="rb-skill-src rb-skill-src--user">user</span>
                                <span className="rb-dialog__skill-desc">{s.description}</span>
                              </span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                    <div>
                      <h4 className="rb-builder__subh">Agent Skills (SKILL.md)</h4>
                      {agentSkills.length === 0 ? (
                        <p className="rb-muted rb-builder__placeholder">
                          No SKILL.md playbooks — add under <code className="rb-code">skills/agentskills/</code>.
                        </p>
                      ) : (
                        <div className="rb-dialog__skill-grid rb-builder__skill-grid">
                          {agentSkills.map(s => (
                            <label key={s.name} className="rb-dialog__skill-item">
                              <input
                                type="checkbox"
                                checked={pickedSkills.has(s.name)}
                                onChange={() => toggleSkill(s.name)}
                              />
                              <span>
                                <strong className="rb-mono">{s.name}</strong>
                                <span className="rb-skill-src rb-skill-src--agentskill">agent skill</span>
                                <span className="rb-dialog__skill-desc">{s.description}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <h4 className="rb-builder__subh">MCP (stdio bridge)</h4>
                      {mcpSkills.length === 0 ? (
                        <p className="rb-muted rb-builder__placeholder">
                          No MCP tools — configure servers under <strong>Settings → MCP servers</strong>.
                        </p>
                      ) : (
                        <div className="rb-dialog__skill-grid rb-builder__skill-grid">
                          {mcpSkills.map(s => (
                            <label key={s.name} className="rb-dialog__skill-item">
                              <input
                                type="checkbox"
                                checked={pickedSkills.has(s.name)}
                                onChange={() => toggleSkill(s.name)}
                              />
                              <span>
                                <strong className="rb-mono">{s.name}</strong>
                                <span className="rb-skill-src rb-skill-src--mcp">mcp</span>
                                <span className="rb-dialog__skill-desc">{s.description}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <h4 className="rb-builder__subh">Marketplace (Vibes-Coded)</h4>
                      {marketplaceSkills.length === 0 ? (
                        <p className="rb-muted rb-builder__placeholder">
                          No imported marketplace skills yet. On <strong>Overview</strong>, open{' '}
                          <strong>Runtime setup</strong> → search Vibes listings and <strong>Install</strong> — then
                          Refresh skills.
                        </p>
                      ) : (
                        <div className="rb-dialog__skill-grid rb-builder__skill-grid">
                          {marketplaceSkills.map(s => (
                            <label key={s.name} className="rb-dialog__skill-item">
                              <input
                                type="checkbox"
                                checked={pickedSkills.has(s.name)}
                                onChange={() => toggleSkill(s.name)}
                              />
                              <span>
                                <strong className="rb-mono">{s.name}</strong>
                                <span className="rb-skill-src rb-skill-src--marketplace">marketplace</span>
                                <span className="rb-dialog__skill-desc">{s.description}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </section>
          )}

          {runtimeMode === 'offline' && (
            <section className="rb-builder__section">
              <h3 className="rb-builder__h">Offline script</h3>
              {localScripts.length === 0 ? (
                <div className="rb-builder__empty">
                  <p>No offline scripts found.</p>
                  <p className="rb-muted">
                    Add a <code className="rb-code">manifest.json</code> or <code className="rb-code">*.mjs</code> files
                    under{' '}
                    {scriptsDir ? <code className="rb-code rb-code--break">{scriptsDir}</code> : 'your offline-scripts directory'}
                    , then refresh the page.
                  </p>
                </div>
              ) : (
                <label className="rb-builder__field">
                  <span>Primary script *</span>
                  <select
                    className="rb-input"
                    value={primaryScriptId}
                    onChange={e => setPrimaryScriptId(e.target.value)}
                  >
                    <option value="">Select a script…</option>
                    {localScripts.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.interpreter})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {localScripts.length > 0 && primaryScriptId && (
                <p className="rb-muted rb-builder__hint">
                  {localScripts.find(s => s.id === primaryScriptId)?.description || '—'}
                </p>
              )}
            </section>
          )}
        </div>

        {err && <p className="rb-builder__err">{err}</p>}

        <footer className="rb-dialog__foot">
          <button type="button" className="rb-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="rb-btn rb-btn--accent"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  );
}
