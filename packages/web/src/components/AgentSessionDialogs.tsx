import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentCardModel, LocalScriptItem, RuntimePayload, SessionPatchPayload } from '../types';
import { SystemMonitorWidget } from './SystemMonitorWidget';
import { ModelPicker } from './ModelPicker';

interface DetailsProps {
  agent: AgentCardModel | null;
  allAgents: AgentCardModel[];
  runtime: RuntimePayload | null;
  localScripts: LocalScriptItem[];
  llmProvider?: string;
  ollamaModels?: string[];
  onRefreshOllamaModels?: () => void;
  onClose: () => void;
  onFleetPatch: (
    sessionId: string,
    patch: { agentRole?: 'agent' | 'orchestrator'; linkedOrchestratorId?: string | null }
  ) => Promise<void>;
  onPatchSession?: (sessionId: string, patch: SessionPatchPayload) => Promise<void>;
  onPinSystemMonitor?: () => void;
  onEdit?: () => void;
  onOpenChat?: () => void;
  onAssignSkills?: () => void;
  /** Switch to Workspace tab (e.g. offline agents). */
  onGoWorkspace?: () => void;
  /** When true, scroll the task & instructions panel into view once (e.g. from Workspace context menu). */
  focusTaskSection?: boolean;
  workspaceRoot?: string | null;
  /** Called after the one-time scroll so parent can clear `focusTaskSection` (avoids repeat scroll on poll). */
  onTaskFocusConsumed?: () => void;
}

export function AgentDetailsDialog({
  agent,
  allAgents,
  runtime,
  localScripts,
  llmProvider,
  ollamaModels = [],
  onRefreshOllamaModels,
  onClose,
  onFleetPatch,
  onPatchSession,
  onPinSystemMonitor,
  onEdit,
  onOpenChat,
  onAssignSkills,
  onGoWorkspace,
  focusTaskSection,
  workspaceRoot,
  onTaskFocusConsumed,
}: DetailsProps) {
  const [fleetBusy, setFleetBusy] = useState(false);
  const [taskPath, setTaskPath] = useState('');
  const [taskMd, setTaskMd] = useState('');
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskErr, setTaskErr] = useState<string | null>(null);
  const taskPanelRef = useRef<HTMLElement | null>(null);
  /** Avoid re-scrolling when `agent` object identity changes every poll. */
  const taskScrollKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!agent) return;
    setTaskPath(agent.agentInstructionsPath ?? '');
    setTaskMd(agent.agentInstructionsMarkdown ?? '');
    setTaskErr(null);
  }, [agent?.id, agent?.agentInstructionsPath, agent?.agentInstructionsMarkdown]);

  useEffect(() => {
    if (!focusTaskSection) {
      taskScrollKeyRef.current = null;
      return;
    }
    if (!agent) return;
    const key = `${agent.id}:task`;
    if (taskScrollKeyRef.current === key) return;
    taskScrollKeyRef.current = key;
    const t = window.setTimeout(() => {
      taskPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      onTaskFocusConsumed?.();
    }, 80);
    return () => clearTimeout(t);
  }, [focusTaskSection, agent?.id, onTaskFocusConsumed]);

  if (!agent) return null;

  const nameByScriptId = Object.fromEntries(localScripts.map(s => [s.id, s.name]));
  const role: 'agent' | 'orchestrator' = agent.agentRole === 'orchestrator' ? 'orchestrator' : 'agent';
  const linked = agent.linkedOrchestratorId ?? null;
  const peerCount = allAgents.filter(a => a.id !== agent.id).length;
  const orchestrators = allAgents.filter(a => a.id !== agent.id && a.agentRole === 'orchestrator');
  const chainedAgents = allAgents.filter(a => a.id !== agent.id && a.linkedOrchestratorId === agent.id);
  const showWorkerLink = role === 'agent' && agent.runtimeMode !== 'offline' && peerCount > 0;
  const showSoloFleetHint = role === 'agent' && agent.runtimeMode !== 'offline' && peerCount === 0;
  const showNoOrchestratorToLink = showWorkerLink && orchestrators.length === 0;

  const runFleet = async (
    patch: { agentRole?: 'agent' | 'orchestrator'; linkedOrchestratorId?: string | null }
  ) => {
    setFleetBusy(true);
    try {
      await onFleetPatch(agent.id, patch);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setFleetBusy(false);
    }
  };

  const saveTaskInstructions = async () => {
    if (!onPatchSession) return;
    setTaskSaving(true);
    setTaskErr(null);
    try {
      const p = taskPath.trim();
      const m = taskMd.trim();
      await onPatchSession(agent.id, {
        agentInstructionsPath: p.length > 0 ? p : null,
        agentInstructionsMarkdown: m.length > 0 ? m : null,
      });
    } catch (e) {
      setTaskErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTaskSaving(false);
    }
  };

  return (
    <div className="rb-dialog-root" role="presentation" onClick={onClose}>
      <div
        className="rb-dialog rb-dialog--wide"
        role="dialog"
        aria-labelledby="agent-details-title"
        onClick={e => e.stopPropagation()}
      >
        <header className="rb-dialog__head">
          <h2 id="agent-details-title" className="rb-dialog__title">
            Agent details
          </h2>
          <button type="button" className="rb-icon-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="rb-detail-quick">
          {onEdit && (
            <button type="button" className="rb-btn rb-btn--accent rb-detail-quick__btn" onClick={() => onEdit()}>
              Edit agent…
            </button>
          )}
          {onOpenChat && agent.runtimeMode !== 'offline' && (
            <button type="button" className="rb-btn rb-detail-quick__btn" onClick={() => onOpenChat()}>
              Open Session
            </button>
          )}
          {onAssignSkills && agent.runtimeMode !== 'offline' && (
            <button type="button" className="rb-btn rb-detail-quick__btn" onClick={() => onAssignSkills()}>
              Assign skills…
            </button>
          )}
          {onGoWorkspace && agent.runtimeMode === 'offline' && (
            <button type="button" className="rb-btn rb-detail-quick__btn" onClick={() => onGoWorkspace()}>
              Open Board
            </button>
          )}
        </div>

        {onPatchSession && (
          <section ref={taskPanelRef} className="rb-task-panel">
            <h3 className="rb-task-panel__title">Task &amp; instructions</h3>
            <p className="rb-muted rb-task-panel__lede">
              For <strong>LLM</strong> agents, this text is merged into the system prompt. Optional: also point at a{' '}
              <code className="rb-code">.md</code> file on disk (relative to the gateway workspace
              {workspaceRoot ? (
                <>
                  : <code className="rb-code rb-code--break">{workspaceRoot}</code>
                </>
              ) : (
                '; set CAPRIGO_WORKSPACE or run the gateway from your project root'
              )}
              ).
            </p>
            <label className="rb-builder__field">
              <span>Instruction file (optional)</span>
              <input
                className="rb-input"
                value={taskPath}
                onChange={e => setTaskPath(e.target.value)}
                placeholder="e.g. docs/agents/playbook.md"
                autoComplete="off"
                disabled={agent.runtimeMode === 'offline'}
              />
            </label>
            <label className="rb-builder__field">
              <span>Task / playbook (markdown)</span>
              <textarea
                className="rb-textarea rb-task-panel__textarea"
                value={taskMd}
                onChange={e => setTaskMd(e.target.value)}
                placeholder="Goals, constraints, tool preferences, checklist…"
                rows={10}
                disabled={agent.runtimeMode === 'offline'}
              />
            </label>
            {agent.runtimeMode === 'offline' && (
              <p className="rb-muted">Switch this card to <strong>LLM</strong> on the Board to use instructions in Session.</p>
            )}
            {taskErr && <p className="rb-builder__err">{taskErr}</p>}
            <div className="rb-task-panel__actions">
              <button
                type="button"
                className="rb-btn rb-btn--accent"
                disabled={taskSaving || agent.runtimeMode === 'offline'}
                onClick={() => void saveTaskInstructions()}
              >
                {taskSaving ? 'Saving…' : 'Save instructions'}
              </button>
            </div>
          </section>
        )}

        <dl className="rb-dialog__dl">
          <dt>Display name</dt>
          <dd>{agent.displayName}</dd>
          <dt>Description</dt>
          <dd>{agent.description?.trim() ? agent.description : <span className="rb-muted">—</span>}</dd>
          <dt>Objective</dt>
          <dd>{agent.objective?.trim() ? agent.objective : <span className="rb-muted">—</span>}</dd>
          <dt>Session id</dt>
          <dd className="rb-code rb-code--break">{agent.id}</dd>
          <dt>Created</dt>
          <dd>{new Date(agent.createdAt).toLocaleString()}</dd>
          <dt>Status</dt>
          <dd>
            <span className={`rb-status-pill rb-status-pill--${agent.status}`}>{agent.status}</span>
          </dd>
          <dt>Messages</dt>
          <dd>{agent.messageCount}</dd>
          <dt>Runtime</dt>
          <dd>
            {agent.runtimeMode === 'offline' ? (
              <span>Offline — disk scripts only (no live Session chat). Change on Board.</span>
            ) : (
              <span>LLM — server model (Ollama / API). Skills apply to Session tools.</span>
            )}
          </dd>
          {agent.runtimeMode !== 'offline' && runtime && onPatchSession && (
            <>
              <dt>Session model</dt>
              <dd>
                <ModelPicker
                  value={agent.model ?? null}
                  onChange={v =>
                    void onPatchSession(agent.id, { model: v }).catch(e =>
                      window.alert(e instanceof Error ? e.message : String(e))
                    )
                  }
                  engineModel={runtime.engine.model}
                  llmProvider={llmProvider || ''}
                  ollamaModels={ollamaModels}
                  onRefreshModels={() => onRefreshOllamaModels?.()}
                />
              </dd>
            </>
          )}
          <dt>Fleet assignment</dt>
          <dd>
            <p className="rb-dialog__lede rb-dialog__lede--tight">
              <strong>Agent</strong> runs tasks and may report to one orchestrator. <strong>Orchestrator</strong>{' '}
              coordinates only the agents <strong>chained to it</strong> (Board <strong>Chain to…</strong> from the
              orchestrator card, or link an agent here). Fleet tools enforce that routing.
            </p>
            <div className="rb-fleet-actions" role="group" aria-label="Fleet assignment">
              <button
                type="button"
                className={`rb-btn${role === 'agent' ? ' rb-btn--accent' : ''}`}
                disabled={fleetBusy}
                aria-pressed={role === 'agent'}
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (role === 'agent') return;
                  void runFleet({ agentRole: 'agent' });
                }}
              >
                Agent
              </button>
              <button
                type="button"
                className={`rb-btn${role === 'orchestrator' ? ' rb-btn--accent' : ''}`}
                disabled={fleetBusy}
                aria-pressed={role === 'orchestrator'}
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (role === 'orchestrator') return;
                  void runFleet({ agentRole: 'orchestrator' });
                }}
              >
                Orchestrator
              </button>
            </div>
            {showSoloFleetHint && (
              <p className="rb-muted rb-dialog__note">
                You only have this session right now. Choose <strong>Orchestrator</strong> if this session should direct
                others; choose <strong>Agent</strong> if it should only execute tasks. Add more sessions from the
                Overview to build a team.
              </p>
            )}
            {role === 'orchestrator' && agent.runtimeMode !== 'offline' && (
              <div className="rb-dialog__note">
                <strong>Agents chained to you</strong>
                {chainedAgents.length === 0 ? (
                  <p className="rb-muted" style={{ marginTop: 8 }}>
                    None yet. On <strong>Board</strong>, right-click this card → <strong>Chain to…</strong> → pick an{' '}
                    <strong>Agent</strong> session, or set another session&apos;s linked orchestrator here.
                  </p>
                ) : (
                  <ul className="rb-dialog__list" style={{ marginTop: 8 }}>
                    {chainedAgents.map(a => (
                      <li key={a.id}>
                        {a.displayName}{' '}
                        <span className="rb-mono rb-muted">({a.id.slice(0, 8)}…)</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {showWorkerLink && (
              <label className="rb-fleet-link">
                <span>Report to orchestrator (task agent)</span>
                <select
                  className="rb-input"
                  value={linked ?? ''}
                  disabled={fleetBusy}
                  onChange={e => {
                    const v = e.target.value;
                    void runFleet({ linkedOrchestratorId: v ? v : null });
                  }}
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
            {showNoOrchestratorToLink && (
              <p className="rb-muted rb-dialog__note">
                No session has fleet assignment <strong>Orchestrator</strong> yet. Open <strong>Details</strong> on the
                session that should lead, choose <strong>Orchestrator</strong>, then pick it here — or make{' '}
                <em>this</em> session the orchestrator.
              </p>
            )}
          </dd>
          <dt>LLM tools (skills)</dt>
          <dd>
            {agent.runtimeMode === 'offline' ? (
              <span className="rb-muted">N/A for offline-only agents</span>
            ) : agent.assignedSkills?.length ? (
              <ul className="rb-dialog__list">
                {agent.assignedSkills.map(n => (
                  <li key={n} className="rb-mono">
                    {n}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="rb-muted">All registered skills</span>
            )}
          </dd>
          <dt>Primary offline script</dt>
          <dd>
            {agent.primaryOfflineScriptId ? (
              nameByScriptId[agent.primaryOfflineScriptId] || agent.primaryOfflineScriptId
            ) : (
              <span className="rb-muted">—</span>
            )}
          </dd>
          <dt>Local scripts (history)</dt>
          <dd>
            {(agent.assignedOfflineScripts?.length ?? 0) === 0 ? (
              <span className="rb-muted">None run yet</span>
            ) : (
              <ul className="rb-dialog__list">
                {(agent.assignedOfflineScripts ?? []).map(id => (
                  <li key={id}>{nameByScriptId[id] || id}</li>
                ))}
              </ul>
            )}
          </dd>
          <dt>Activity tasks</dt>
          <dd>
            {agent.tasks.length === 0 ? (
              <span className="rb-muted">None</span>
            ) : (
              <ul className="rb-dialog__list">
                {agent.tasks.map(t => (
                  <li key={t.taskId}>
                    {t.status}
                    {t.done ? ' (done)' : ''}
                    {t.permissionWait ? ' — needs approval' : ''}
                  </li>
                ))}
              </ul>
            )}
          </dd>
          {agent.lastError && (
            <>
              <dt>Last error</dt>
              <dd className="rb-agent-card__err rb-dialog__err">{agent.lastError}</dd>
            </>
          )}
          {runtime && (
            <>
              <dt>Engine</dt>
              <dd>
                {runtime.engine.name} · model <span className="rb-mono">{runtime.engine.model}</span>
              </dd>
            </>
          )}
          <dt className="rb-dialog__section-dt">System monitor</dt>
          <dd className="rb-dialog__monitor-wrap">
            <p className="rb-muted rb-dialog__lede--tight">
              Live view of the machine running the gateway (not this session). Use <span className="rb-mono">system_monitor</span>{' '}
              in Session tools for the same snapshot.
            </p>
            <SystemMonitorWidget layout="embedded" pollMs={2800} onPin={onPinSystemMonitor} />
          </dd>
        </dl>
      </div>
    </div>
  );
}

interface SkillsProps {
  agent: AgentCardModel | null;
  catalog: { name: string; description: string }[];
  onClose: () => void;
  onSave: (sessionId: string, assignedSkills: string[]) => Promise<void>;
}

export function AgentSkillsDialog({ agent, catalog, onClose, onSave }: SkillsProps) {
  const [useAll, setUseAll] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [skillFilter, setSkillFilter] = useState('');

  useEffect(() => {
    if (!agent) return;
    const w = agent.assignedSkills;
    const has = !!(w && w.length);
    setUseAll(!has);
    setPicked(has ? new Set(w!) : new Set());
    setSkillFilter('');
  }, [agent]);

  const filtered = useMemo(() => {
    const qq = skillFilter.trim().toLowerCase();
    if (!qq) return catalog;
    return catalog.filter(
      s =>
        s.name.toLowerCase().includes(qq) ||
        (s.description || '').toLowerCase().includes(qq)
    );
  }, [catalog, skillFilter]);

  if (!agent) return null;

  const toggle = (name: string) => {
    setPicked(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const list = useAll ? [] : [...picked];
      await onSave(agent.id, list);
      onClose();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rb-dialog-root" role="presentation" onClick={onClose}>
      <div
        className="rb-dialog rb-dialog--wide"
        role="dialog"
        aria-labelledby="agent-skills-title"
        onClick={e => e.stopPropagation()}
      >
        <header className="rb-dialog__head">
          <h2 id="agent-skills-title" className="rb-dialog__title">
            Skills for “{agent.displayName}”
          </h2>
          <button type="button" className="rb-icon-btn" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="rb-dialog__lede">
          Choose which tools the model may call for this session. When <strong>Use all skills</strong> is on, the full
          catalog is available.
        </p>
        <label className="rb-dialog__check-row">
          <input
            type="checkbox"
            checked={useAll}
            onChange={e => {
              setUseAll(e.target.checked);
              if (e.target.checked) setPicked(new Set());
            }}
          />
          <span>Use all registered skills ({catalog.length})</span>
        </label>
        {!useAll && (
          <>
            <input
              className="rb-input rb-builder__search"
              placeholder="Search skills…"
              value={skillFilter}
              onChange={e => setSkillFilter(e.target.value)}
              aria-label="Filter skills"
            />
            <div className="rb-dialog__skill-grid">
              {catalog.length === 0 ? (
                <p className="rb-muted">No skills loaded on the server.</p>
              ) : filtered.length === 0 ? (
                <p className="rb-muted">No skills match your search.</p>
              ) : (
                filtered.map(s => (
                  <label key={s.name} className="rb-dialog__skill-item">
                    <input type="checkbox" checked={picked.has(s.name)} onChange={() => toggle(s.name)} />
                    <span>
                      <strong className="rb-mono">{s.name}</strong>
                      <span className="rb-dialog__skill-desc">{s.description}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </>
        )}
        <footer className="rb-dialog__foot">
          <button type="button" className="rb-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="rb-btn rb-btn--accent"
            onClick={() => void save()}
            disabled={saving || (!useAll && catalog.length > 0 && picked.size === 0)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
