import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentCardModel, ExecutionTraceEntry, LocalScriptItem } from '../types';
import { LEGACY_OPEN_WORKSPACE_KEY } from '../legacyStorageKeys';
import { ModelPicker } from './ModelPicker';
import { WORKFLOW_LIBRARY, type WorkflowTemplateId } from './workflows';
import { estimateTracePressure } from './traceHeuristics';
import { loadWorkflowRecipes, makeRecipeId, saveWorkflowRecipes, type WorkflowRecipe } from './workflowRecipes';

const STORAGE_KEY = 'caprigo.openWorkspace.v1';
const NODE_W = 268;
const NODE_H = 248;

interface PersistedWorkspace {
  positions: Record<string, { x: number; y: number }>;
}

function loadWorkspace(): PersistedWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_OPEN_WORKSPACE_KEY);
    const r = JSON.parse(raw || 'null');
    return {
      positions: r?.positions && typeof r.positions === 'object' ? r.positions : {},
    };
  } catch {
    return { positions: {} };
  }
}

function defaultPos(index: number): { x: number; y: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 48 + col * (NODE_W + 36), y: 56 + row * (NODE_H + 40) };
}

interface Props {
  agents: AgentCardModel[];
  selectedId: string | null;
  traceEntries: ExecutionTraceEntry[];
  workspaceNotice?: {
    title: string;
    detail: string;
    tone: 'info' | 'success';
    checklist?: string[];
    primaryAction?: {
      label: string;
      agentId: string;
      runtimeMode: 'llm' | 'offline';
      draft?: string;
    };
  } | null;
  localScripts: LocalScriptItem[];
  scriptsDir: string | null;
  offlineRunningId: string | null;
  onRunOfflineScript: (sessionId: string, scriptId: string) => Promise<void>;
  onSetRuntimeMode: (id: string, mode: 'llm' | 'offline') => Promise<void>;
  onSelectAgent: (id: string) => void;
  onOpenBuilder: () => void;
  onOpenWorkflowLibrary: () => void;
  onEditAgent: (id: string) => void;
  onRefreshAgents: () => Promise<AgentCardModel[]>;
  onCloseAgent: (id: string) => void;
  onRenameAgent: (id: string) => void;
  onAgentDetails: (id: string) => void;
  /** Open details scrolled to Task & instructions. */
  onAgentTaskInstructions: (id: string) => void;
  onAgentSkills: (id: string) => void;
  /** Select agent and jump to Session (LLM) or stay on Board (offline). */
  onPlayAgent: (id: string, runtimeMode: 'llm' | 'offline', draft?: string) => void;
  /** Best-effort stop for in-flight LLM turn. */
  onStopAgent: (id: string) => void;
  /** Chain orchestrator -> task agent: sets the worker's linked orchestrator. */
  onLinkWorkerToOrchestrator: (workerSessionId: string, orchestratorSessionId: string | null) => Promise<void>;
  onSetAgentRole: (sessionId: string, role: 'agent' | 'orchestrator') => Promise<void>;
  onLaunchCrew: (
    templateId: WorkflowTemplateId,
    options?: { recipeName?: string; leadInstructionsMarkdown?: string }
  ) => Promise<void>;
  engineModel: string;
  llmProvider?: string;
  ollamaModels: string[];
  onRefreshOllamaModels: () => void;
  onSetSessionModel: (sessionId: string, model: string | null) => Promise<void>;
}

export function DeskPanel({
  agents,
  selectedId,
  traceEntries,
  workspaceNotice,
  localScripts,
  scriptsDir,
  offlineRunningId,
  onRunOfflineScript,
  onSetRuntimeMode,
  onSelectAgent,
  onOpenBuilder,
  onOpenWorkflowLibrary,
  onEditAgent,
  onRefreshAgents,
  onCloseAgent,
  onRenameAgent,
  onAgentDetails,
  onAgentTaskInstructions,
  onAgentSkills,
  onPlayAgent,
  onStopAgent,
  onLinkWorkerToOrchestrator,
  onSetAgentRole,
  onLaunchCrew,
  engineModel,
  llmProvider,
  ollamaModels,
  onRefreshOllamaModels,
  onSetSessionModel,
}: Props) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => loadWorkspace().positions);
  const [edges, setEdges] = useState<Array<{ from: string; to: string }>>([]);
  const [drag, setDrag] = useState<{
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; agentId: string } | null>(null);
  const [chainPick, setChainPick] = useState(false);
  const [scriptPick, setScriptPick] = useState<Record<string, string>>({});
  const [recipes, setRecipes] = useState<WorkflowRecipe[]>(() => loadWorkflowRecipes());
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<{
    name: string;
    templateId: WorkflowTemplateId;
    triggerKind: WorkflowRecipe['triggerKind'];
    triggerValue: string;
    leadInstructionsMarkdown: string;
  }>({
    name: '',
    templateId: 'repo-coding',
    triggerKind: 'manual',
    triggerValue: '',
    leadInstructionsMarkdown: '',
  });

  const localNameById = useMemo(() => Object.fromEntries(localScripts.map(s => [s.id, s.name])), [localScripts]);
  const traceBySessionId = useMemo(() => {
    const map = new Map<string, ExecutionTraceEntry[]>();
    for (const entry of traceEntries) {
      if (!entry.sessionId) continue;
      const bucket = map.get(entry.sessionId) ?? [];
      bucket.push(entry);
      map.set(entry.sessionId, bucket);
    }
    return map;
  }, [traceEntries]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ positions }));
  }, [positions]);

  useEffect(() => {
    setEdges(
      agents
        .filter(a => a.linkedOrchestratorId)
        .map(a => ({ from: a.linkedOrchestratorId as string, to: a.id }))
    );
  }, [agents]);

  useEffect(() => {
    setPositions(prev => {
      const next = { ...prev };
      let changed = false;
      agents.forEach((a, i) => {
        if (next[a.id] === undefined) {
          next[a.id] = defaultPos(i);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [agents]);

  const pruneStale = useCallback(() => {
    const ids = new Set(agents.map(a => a.id));
    setPositions(p => {
      const next = { ...p };
      let c = false;
      Object.keys(next).forEach(k => {
        if (!ids.has(k)) {
          delete next[k];
          c = true;
        }
      });
      return c ? next : p;
    });
    setEdges(e => e.filter(x => ids.has(x.from) && ids.has(x.to)));
  }, [agents]);

  useEffect(() => {
    pruneStale();
  }, [pruneStale]);

  useEffect(() => {
    setScriptPick(prev => {
      const next = { ...prev };
      let changed = false;
      agents.forEach(a => {
        const serverPick = a.primaryOfflineScriptId ?? '';
        if ((next[a.id] ?? '') !== serverPick) {
          next[a.id] = serverPick;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [agents]);

  useEffect(() => {
    saveWorkflowRecipes(recipes);
  }, [recipes]);

  const beginCreateRecipe = () => {
    setEditingRecipeId(null);
    setRecipeDraft({
      name: '',
      templateId: 'repo-coding',
      triggerKind: 'manual',
      triggerValue: '',
      leadInstructionsMarkdown: '',
    });
  };

  const beginEditRecipe = (recipe: WorkflowRecipe) => {
    setEditingRecipeId(recipe.id);
    setRecipeDraft({
      name: recipe.name,
      templateId: recipe.templateId,
      triggerKind: recipe.triggerKind,
      triggerValue: recipe.triggerValue,
      leadInstructionsMarkdown: recipe.leadInstructionsMarkdown,
    });
  };

  const saveRecipeDraft = () => {
    const name = recipeDraft.name.trim();
    if (!name) {
      window.alert('Recipe name is required.');
      return;
    }
    const now = Date.now();
    if (editingRecipeId) {
      setRecipes(prev =>
        prev.map(item =>
          item.id === editingRecipeId
            ? {
                ...item,
                name,
                templateId: recipeDraft.templateId,
                triggerKind: recipeDraft.triggerKind,
                triggerValue: recipeDraft.triggerValue.trim(),
                leadInstructionsMarkdown: recipeDraft.leadInstructionsMarkdown.trim(),
                updatedAt: now,
              }
            : item
        )
      );
    } else {
      setRecipes(prev => [
        {
          id: makeRecipeId(),
          name,
          templateId: recipeDraft.templateId,
          triggerKind: recipeDraft.triggerKind,
          triggerValue: recipeDraft.triggerValue.trim(),
          leadInstructionsMarkdown: recipeDraft.leadInstructionsMarkdown.trim(),
          createdAt: now,
          updatedAt: now,
        },
        ...prev,
      ]);
    }
    beginCreateRecipe();
  };

  const deleteRecipe = (id: string) => {
    if (!window.confirm('Delete this workflow recipe?')) return;
    setRecipes(prev => prev.filter(item => item.id !== id));
    if (editingRecipeId === id) beginCreateRecipe();
  };

  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = positions[id] || { x: 0, y: 0 };
    setDrag({
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      setPositions(p => ({
        ...p,
        [drag.id]: {
          x: Math.max(8, drag.origX + dx),
          y: Math.max(8, drag.origY + dy),
        },
      }));
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = (ev: MouseEvent) => {
      const el = ev.target as HTMLElement;
      if (el.closest('.rb-ow-ctx')) return;
      setCtxMenu(null);
      setChainPick(false);
    };
    const id = window.setTimeout(() => document.addEventListener('mousedown', close), 10);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', close);
    };
  }, [ctxMenu]);

  const extent = useMemo(() => {
    let w = 960;
    let h = 640;
    agents.forEach(a => {
      const p = positions[a.id];
      if (p) {
        w = Math.max(w, p.x + NODE_W + 80);
        h = Math.max(h, p.y + NODE_H + 80);
      }
    });
    return { width: w, height: h };
  }, [agents, positions]);

  const crewShells = useMemo(() => {
    const shells: Array<{
      id: string;
      label: string;
      memberCount: number;
      left: number;
      top: number;
      width: number;
      height: number;
      selected: boolean;
    }> = [];

    for (const orchestrator of agents.filter(agent => agent.agentRole === 'orchestrator')) {
      const members = agents.filter(
        agent => agent.id === orchestrator.id || agent.linkedOrchestratorId === orchestrator.id
      );
      if (members.length <= 1) continue;

      const coords = members
        .map(agent => positions[agent.id])
        .filter((point): point is { x: number; y: number } => !!point);
      if (coords.length === 0) continue;

      const left = Math.max(12, Math.min(...coords.map(point => point.x)) - 22);
      const top = Math.max(16, Math.min(...coords.map(point => point.y)) - 34);
      const right = Math.max(...coords.map(point => point.x + NODE_W)) + 22;
      const bottom = Math.max(...coords.map(point => point.y + NODE_H)) + 22;

      shells.push({
        id: orchestrator.id,
        label: orchestrator.displayName,
        memberCount: members.length - 1,
        left,
        top,
        width: right - left,
        height: bottom - top,
        selected:
          selectedId === orchestrator.id ||
          members.some(agent => agent.id !== orchestrator.id && agent.id === selectedId),
      });
    }

    return shells;
  }, [agents, positions, selectedId]);

  const selectedCrew = useMemo(() => {
    if (!selectedId) return null;
    const selectedAgent = agents.find(agent => agent.id === selectedId);
    if (!selectedAgent) return null;

    const orchestratorId =
      selectedAgent.agentRole === 'orchestrator' ? selectedAgent.id : selectedAgent.linkedOrchestratorId ?? null;
    if (!orchestratorId) return null;

    const lead = agents.find(agent => agent.id === orchestratorId && agent.agentRole === 'orchestrator');
    if (!lead) return null;

    const members = agents.filter(agent => agent.linkedOrchestratorId === orchestratorId);
    return { lead, members, selectedAgent };
  }, [agents, selectedId]);

  const addChain = async (from: string, to: string) => {
    if (from === to) return;
    const source = agents.find(a => a.id === from);
    if (!source) return;
    if (source.agentRole !== 'orchestrator') {
      window.alert(
        'Set the source card to Orchestrator in Details, then use Chain to... from that card toward a worker agent.'
      );
      return;
    }
    try {
      await onLinkWorkerToOrchestrator(to, from);
      setEdges(e => {
        if (e.some(x => x.from === from && x.to === to)) return e;
        return [...e, { from, to }];
      });
      setCtxMenu(null);
      setChainPick(false);
      await onRefreshAgents();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  const assignWorkerToOrchestrator = async (workerId: string, orchestratorId: string | null) => {
    try {
      await onLinkWorkerToOrchestrator(workerId, orchestratorId);
      setCtxMenu(null);
      setChainPick(false);
      await onRefreshAgents();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  const setFleetRole = async (id: string, role: 'agent' | 'orchestrator') => {
    const target = agents.find(agent => agent.id === id);
    if (!target) return;
    const linkedWorkers = agents.filter(agent => agent.linkedOrchestratorId === id);
    if (role === 'agent' && target.agentRole === 'orchestrator' && linkedWorkers.length > 0) {
      window.alert(`Detach ${linkedWorkers.length} linked worker${linkedWorkers.length === 1 ? '' : 's'} before converting this orchestrator.`);
      return;
    }
    if (role === 'orchestrator' && target.linkedOrchestratorId) {
      const ok = window.confirm(
        `${target.displayName} currently reports to another orchestrator. Promote it and detach it from that crew?`
      );
      if (!ok) return;
    }
    try {
      await onSetAgentRole(id, role);
      setCtxMenu(null);
      setChainPick(false);
      await onRefreshAgents();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  const clearChainsFor = async (id: string) => {
    const removed = agents
      .filter(a => a.linkedOrchestratorId === id || a.id === id)
      .map(a => ({ from: a.linkedOrchestratorId || '', to: a.id }))
      .filter(x => x.from);
    setEdges(e => e.filter(x => x.from !== id && x.to !== id));
    setCtxMenu(null);
    setChainPick(false);
    for (const edge of removed) {
      const w = agents.find(a => a.id === edge.to);
      if (w?.linkedOrchestratorId === edge.from) {
        try {
          await onLinkWorkerToOrchestrator(edge.to, null);
        } catch {
          /* ignore */
        }
      }
    }
    await onRefreshAgents();
  };

  return (
    <div className="rb-ow">
      <header className="rb-ow__toolbar">
        <div>
          <h1 className="rb-ow__title">Board</h1>
          <p className="rb-ow__lede">
            Arrange live agents, switch each one between <strong>LLM</strong> and <strong>Local</strong>, run offline
            scripts, and wire orchestrators to workers. This is the operational board for the same agents you open in
            Session view.
          </p>
          {scriptsDir && (
            <p className="rb-ow__catalog-path rb-muted" title={scriptsDir}>
              Offline catalog: <code className="rb-code rb-code--break">{scriptsDir}</code>
            </p>
          )}
        </div>
        <div className="rb-ow__toolbar-actions">
          <button type="button" className="rb-btn" onClick={onOpenWorkflowLibrary}>
            Workflow library
          </button>
          <button type="button" className="rb-btn rb-btn--accent" onClick={onOpenBuilder}>
            Add agent
          </button>
        </div>
      </header>
      <section className="rb-ow__recipes">
        <div className="rb-ow__recipes-head">
          <strong>Workflow Recipes</strong>
          <span className="rb-muted">Saved orchestrator presets with optional trigger metadata and lead instructions.</span>
        </div>
        <div className="rb-ow__recipes-grid">
          <div className="rb-ow__recipe-editor">
            <label className="rb-ow__recipe-field">
              <span>Name</span>
              <input
                className="rb-input"
                value={recipeDraft.name}
                onChange={e => setRecipeDraft(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Repo PR sweep"
              />
            </label>
            <label className="rb-ow__recipe-field">
              <span>Workflow</span>
              <select
                className="rb-input"
                value={recipeDraft.templateId}
                onChange={e =>
                  setRecipeDraft(prev => ({ ...prev, templateId: e.target.value as WorkflowTemplateId }))
                }
              >
                {WORKFLOW_LIBRARY.map(flow => (
                  <option key={flow.id} value={flow.id}>
                    {flow.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="rb-ow__recipe-field">
              <span>Trigger</span>
              <select
                className="rb-input"
                value={recipeDraft.triggerKind}
                onChange={e =>
                  setRecipeDraft(prev => ({ ...prev, triggerKind: e.target.value as WorkflowRecipe['triggerKind'] }))
                }
              >
                <option value="manual">Manual</option>
                <option value="file-change">On file change</option>
                <option value="daily-sweep">Daily sweep</option>
              </select>
            </label>
            <label className="rb-ow__recipe-field">
              <span>Trigger condition</span>
              <input
                className="rb-input"
                value={recipeDraft.triggerValue}
                onChange={e => setRecipeDraft(prev => ({ ...prev, triggerValue: e.target.value }))}
                placeholder='e.g. src/**/*.ts or "09:00 daily"'
              />
            </label>
            <label className="rb-ow__recipe-field">
              <span>Lead instructions</span>
              <textarea
                className="rb-textarea"
                rows={4}
                value={recipeDraft.leadInstructionsMarkdown}
                onChange={e => setRecipeDraft(prev => ({ ...prev, leadInstructionsMarkdown: e.target.value }))}
                placeholder="Optional markdown injected into lead instructions."
              />
            </label>
            <div className="rb-ow__recipe-actions">
              <button type="button" className="rb-btn rb-btn--accent" onClick={saveRecipeDraft}>
                {editingRecipeId ? 'Update recipe' : 'Save recipe'}
              </button>
              {editingRecipeId && (
                <button type="button" className="rb-btn" onClick={beginCreateRecipe}>
                  New recipe
                </button>
              )}
            </div>
          </div>
          <div className="rb-ow__recipe-list">
            {recipes.length === 0 ? (
              <p className="rb-muted">No recipes yet. Save one to reuse orchestrator workflows.</p>
            ) : (
              recipes.map(recipe => {
                const flow = WORKFLOW_LIBRARY.find(item => item.id === recipe.templateId);
                return (
                  <article key={recipe.id} className="rb-ow__recipe-card">
                    <div>
                      <strong>{recipe.name}</strong>
                      <div className="rb-muted">{flow?.title ?? recipe.templateId}</div>
                    </div>
                    <div className="rb-ow__recipe-meta">
                      <span>Trigger: {recipe.triggerKind}</span>
                      {recipe.triggerValue && <span>{recipe.triggerValue}</span>}
                    </div>
                    <div className="rb-ow__recipe-card-actions">
                      <button
                        type="button"
                        className="rb-btn rb-btn--accent rb-btn--tight"
                        onClick={() =>
                          void onLaunchCrew(recipe.templateId, {
                            recipeName: recipe.name,
                            leadInstructionsMarkdown: recipe.leadInstructionsMarkdown,
                          })
                        }
                      >
                        Launch
                      </button>
                      <button type="button" className="rb-icon-btn" onClick={() => beginEditRecipe(recipe)}>
                        Edit
                      </button>
                      <button type="button" className="rb-icon-btn rb-icon-btn--danger" onClick={() => deleteRecipe(recipe.id)}>
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      </section>
      {workspaceNotice && (
        <section
          className={`rb-ow__notice rb-ow__notice--${workspaceNotice.tone}`}
          aria-live="polite"
        >
          <div className="rb-ow__notice-copy">
            <strong>{workspaceNotice.title}</strong>
            <span>{workspaceNotice.detail}</span>
            {workspaceNotice.checklist?.length ? (
              <ul className="rb-ow__notice-list">
                {workspaceNotice.checklist.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
          {workspaceNotice.primaryAction && (
            <div className="rb-ow__notice-actions">
              <button
                type="button"
                className="rb-btn rb-btn--accent rb-btn--tight"
                onClick={() =>
                  onPlayAgent(
                    workspaceNotice.primaryAction!.agentId,
                    workspaceNotice.primaryAction!.runtimeMode,
                    workspaceNotice.primaryAction!.draft
                  )
                }
              >
                {workspaceNotice.primaryAction.label}
              </button>
            </div>
          )}
        </section>
      )}
      {selectedCrew && (
        <section className="rb-ow__crew-strip" aria-label="Selected crew">
          <div className="rb-ow__crew-strip-main">
            <span className="rb-ow__crew-strip-label">Selected crew</span>
            <div className="rb-ow__crew-strip-title-row">
              <strong>{selectedCrew.lead.displayName}</strong>
              <span className="rb-ow__crew-strip-meta">
                {selectedCrew.members.length} worker{selectedCrew.members.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="rb-ow__crew-strip-hint">
              {selectedCrew.selectedAgent.id === selectedCrew.lead.id
                ? 'Crew lead selected. Use Board for coordination and Session for higher-level planning or reporting.'
                : `${selectedCrew.selectedAgent.displayName} reports to this lead. Jump between members here without hunting across the canvas.`}
            </p>
          </div>
          <div className="rb-ow__crew-strip-actions">
            <button
              type="button"
              className="rb-btn rb-btn--accent"
              onClick={() => onPlayAgent(selectedCrew.lead.id, selectedCrew.lead.runtimeMode === 'offline' ? 'offline' : 'llm')}
            >
              {selectedCrew.lead.runtimeMode === 'offline' ? 'Open lead on board' : 'Open lead session'}
            </button>
            <button
              type="button"
              className="rb-btn"
              onClick={() => onAgentDetails(selectedCrew.lead.id)}
            >
              Lead details
            </button>
          </div>
          <div className="rb-ow__crew-strip-members">
            <button
              type="button"
              className={`rb-ow__crew-chip${selectedCrew.selectedAgent.id === selectedCrew.lead.id ? ' rb-ow__crew-chip--selected' : ''}`}
              onClick={() => onSelectAgent(selectedCrew.lead.id)}
            >
              Lead · {selectedCrew.lead.displayName}
            </button>
            {selectedCrew.members.map(member => (
              <button
                key={member.id}
                type="button"
                className={`rb-ow__crew-chip${selectedCrew.selectedAgent.id === member.id ? ' rb-ow__crew-chip--selected' : ''}`}
                onClick={() => onSelectAgent(member.id)}
              >
                {member.runtimeMode === 'offline' ? 'Local' : 'LLM'} · {member.displayName}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="rb-ow__canvas-wrap">
        <div className="rb-ow__canvas" style={{ width: extent.width, minHeight: extent.height }}>
          <svg className="rb-ow__svg" width={extent.width} height={extent.height} aria-hidden>
            <defs>
              <marker id="rb-ow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 Z" fill="rgba(61,158,255,0.55)" />
              </marker>
            </defs>
            {edges.map((e, i) => {
              const a = positions[e.from];
              const b = positions[e.to];
              if (!a || !b) return null;
              const x1 = a.x + NODE_W / 2;
              const y1 = a.y + NODE_H;
              const x2 = b.x + NODE_W / 2;
              const y2 = b.y;
              const mx = (x1 + x2) / 2;
              const d = `M ${x1} ${y1} Q ${mx} ${y1 + 40} ${x2} ${y2}`;
              return (
                <path
                  key={`${e.from}-${e.to}-${i}`}
                  d={d}
                  fill="none"
                  stroke="rgba(61,158,255,0.35)"
                  strokeWidth={2}
                  markerEnd="url(#rb-ow-arrow)"
                />
              );
            })}
          </svg>

          {crewShells.map(shell => (
            <section
              key={shell.id}
              className={`rb-ow-crew${shell.selected ? ' rb-ow-crew--selected' : ''}`}
              style={{
                left: shell.left,
                top: shell.top,
                width: shell.width,
                minHeight: shell.height,
              }}
              aria-hidden
            >
              <div className="rb-ow-crew__label">
                <span className="rb-ow-crew__title">{shell.label}</span>
                <span className="rb-ow-crew__meta">
                  {shell.memberCount} worker{shell.memberCount === 1 ? '' : 's'}
                </span>
              </div>
            </section>
          ))}

          {agents.length === 0 && (
            <div className="rb-ow__empty">
              <p>Nothing on the board yet.</p>
              <p className="rb-muted">
                Click <strong>Add agent</strong> to create one. Add more as roles become clear, then right-click a card
                to chain workers to an orchestrator.
              </p>
            </div>
          )}

          {agents.map(a => {
            const p = positions[a.id] || defaultPos(0);
            const assigned = a.assignedOfflineScripts ?? [];
            const skillN = a.assignedSkills?.length ?? 0;
            const skillShort = skillN === 0 ? 'All skills' : `${skillN} skills`;
            const mode = a.runtimeMode === 'offline' ? 'offline' : 'llm';
            const selected = selectedId === a.id;
            const linkedWorkerCount = agents.filter(x => x.linkedOrchestratorId === a.id).length;
            const selectedAgent = agents.find(agent => agent.id === selectedId) ?? null;
            const pressure = estimateTracePressure((traceBySessionId.get(a.id) ?? []).slice(-24));
            const isCrewRelative =
              !!selectedAgent &&
              (selectedAgent.id === a.id ||
                selectedAgent.linkedOrchestratorId === a.id ||
                a.linkedOrchestratorId === selectedAgent.id ||
                (selectedAgent.linkedOrchestratorId !== null &&
                  selectedAgent.linkedOrchestratorId !== undefined &&
                  a.linkedOrchestratorId === selectedAgent.linkedOrchestratorId));
            return (
              <article
                key={a.id}
                className={`rb-ow-node${selected ? ' rb-ow-node--selected' : ''}${drag?.id === a.id ? ' rb-ow-node--drag' : ''}${isCrewRelative ? ' rb-ow-node--crew' : ''}`}
                style={{ left: p.x, top: p.y, width: NODE_W }}
                onPointerDown={e => onNodePointerDown(e, a.id)}
                onClick={e => {
                  e.stopPropagation();
                  onSelectAgent(a.id);
                }}
                onContextMenu={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSelectAgent(a.id);
                  setChainPick(false);
                  setCtxMenu({ x: e.clientX, y: e.clientY, agentId: a.id });
                }}
              >
                <div className="rb-ow-node__drag-hint" title="Drag to move">
                  <span className="rb-ow-node__grip" />
                  <h3 className="rb-ow-node__name">{a.displayName}</h3>
                  <span className={`rb-status-dot rb-status-dot--${a.status}`} />
                </div>
                <div className="rb-ow-node__transport" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                  <button
                    type="button"
                    className="rb-btn rb-ow-node__transport-btn rb-ow-node__transport-btn--play"
                    title={
                      mode === 'llm'
                        ? 'Open Session view with this agent and focus the message box'
                        : 'Select this card and stay on the Board for disk scripts'
                    }
                    onClick={e => {
                      e.stopPropagation();
                      onPlayAgent(a.id, mode);
                    }}
                  >
                    {mode === 'llm' ? 'Chat' : 'Select'}
                  </button>
                  <button
                    type="button"
                    className="rb-btn rb-ow-node__transport-btn rb-ow-node__transport-btn--stop"
                    title="Stop in-flight LLM turn (best effort)"
                    disabled={mode !== 'llm' || a.status !== 'thinking'}
                    onClick={e => {
                      e.stopPropagation();
                      void onStopAgent(a.id);
                    }}
                  >
                    Stop
                  </button>
                </div>
                {a.description?.trim() ? (
                  <p className="rb-ow-node__desc">
                    {a.description.trim().slice(0, 100)}
                    {a.description.length > 100 ? '...' : ''}
                  </p>
                ) : null}
                <div className="rb-ow-node__meta">
                  <span className="rb-mono">{a.id.slice(0, 8)}...</span>
                  <span>{a.messageCount} msgs</span>
                  <span title="Fleet: Agent runs tasks; Orchestrator coordinates chained agents">
                    {a.agentRole === 'orchestrator' ? 'Orchestrator' : 'Agent'}
                  </span>
                  <span title="LLM tools for this session">{mode === 'llm' ? skillShort : '-'}</span>
                </div>
                <div className="rb-ow-node__fleet">
                  {a.agentRole === 'orchestrator' ? (
                    <span className="rb-fleet-pill" title="Workers linked to this orchestrator">
                      {linkedWorkerCount} worker{linkedWorkerCount === 1 ? '' : 's'}
                    </span>
                  ) : a.linkedOrchestratorId ? (
                    <span className="rb-fleet-pill rb-fleet-pill--link" title={`Reports to ${a.linkedOrchestratorId}`}>
                      Reports to {a.linkedOrchestratorId.slice(0, 6)}...
                    </span>
                  ) : (
                    <span className="rb-ow-node__fleet-muted">Standalone</span>
                  )}
                  {selected && a.agentRole === 'orchestrator' && linkedWorkerCount > 0 && (
                    <span className="rb-ow-node__fleet-muted">Crew lead</span>
                  )}
                  {selected && a.linkedOrchestratorId && (
                    <span className="rb-ow-node__fleet-muted">Crew member</span>
                  )}
                  {pressure && (pressure.pressure === 'heavy' || pressure.costSignal === 'high') && (
                    <span className="rb-ow-node__fleet-warn" title="Recent trace suggests high context or cost pressure for this session">
                      Heavy
                    </span>
                  )}
                </div>
                <div className="rb-ws-seg" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                  <button
                    type="button"
                    className={`rb-ws-seg__btn${mode === 'llm' ? ' rb-ws-seg__btn--on' : ''}`}
                    title="Use the server LLM for this agent in Session view"
                    onClick={e => {
                      e.stopPropagation();
                      void onSetRuntimeMode(a.id, 'llm').catch(err =>
                        window.alert(err instanceof Error ? err.message : String(err))
                      );
                    }}
                  >
                    LLM
                  </button>
                  <button
                    type="button"
                    className={`rb-ws-seg__btn${mode === 'offline' ? ' rb-ws-seg__btn--on-offline' : ''}`}
                    title="Offline only - disk scripts on the Board, no Session chat"
                    onClick={e => {
                      e.stopPropagation();
                      void onSetRuntimeMode(a.id, 'offline').catch(err =>
                        window.alert(err instanceof Error ? err.message : String(err))
                      );
                    }}
                  >
                    Local
                  </button>
                </div>
                {mode === 'llm' && (
                  <div
                    className="rb-ow-node__model"
                    onClick={e => e.stopPropagation()}
                    onPointerDown={e => e.stopPropagation()}
                  >
                    <ModelPicker
                      compact
                      id={`ws-model-${a.id}`}
                      value={a.model ?? null}
                      onChange={v =>
                        void onSetSessionModel(a.id, v).catch(err =>
                          window.alert(err instanceof Error ? err.message : String(err))
                        )
                      }
                      engineModel={engineModel}
                      llmProvider={llmProvider || ''}
                      ollamaModels={ollamaModels}
                      onRefreshModels={onRefreshOllamaModels}
                    />
                  </div>
                )}
                <div className="rb-ow-node__local-run" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
                  <select
                    className="rb-input rb-ow-node__script-select"
                    value={scriptPick[a.id] ?? ''}
                    disabled={localScripts.length === 0 || !!offlineRunningId}
                    onChange={e =>
                      setScriptPick(p => ({
                        ...p,
                        [a.id]: e.target.value,
                      }))
                    }
                    aria-label={`Script for ${a.displayName}`}
                  >
                    <option value="">{localScripts.length === 0 ? 'No scripts in catalog' : 'Script...'}</option>
                    {localScripts.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.interpreter})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rb-btn rb-ow-node__run-btn"
                    disabled={!scriptPick[a.id] || !!offlineRunningId}
                    onClick={e => {
                      e.stopPropagation();
                      const sid = scriptPick[a.id];
                      if (sid) void onRunOfflineScript(a.id, sid);
                    }}
                  >
                    {offlineRunningId === a.id ? '...' : offlineRunningId ? 'Busy' : 'Run'}
                  </button>
                </div>
                {assigned.length > 0 && (
                  <div className="rb-ow-node__tags">
                    {assigned.slice(0, 4).map(id => (
                      <span key={id} className="rb-local-tag">
                        {localNameById[id] || id}
                      </span>
                    ))}
                    {assigned.length > 4 && <span className="rb-muted">+{assigned.length - 4}</span>}
                  </div>
                )}
                <div className="rb-ow-node__actions">
                  <button
                    type="button"
                    className="rb-icon-btn"
                    onClick={e => {
                      e.stopPropagation();
                      onRenameAgent(a.id);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="rb-icon-btn rb-icon-btn--danger"
                    onClick={e => {
                      e.stopPropagation();
                      onCloseAgent(a.id);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {ctxMenu && (
        <div
          className="rb-ow-ctx"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={e => e.stopPropagation()}
          role="menu"
        >
          {!chainPick ? (
            <>
              {agents.find(x => x.id === ctxMenu.agentId)?.agentRole !== 'orchestrator' ? (
                <button
                  type="button"
                  className="rb-ow-ctx__item"
                  onClick={() => void setFleetRole(ctxMenu.agentId, 'orchestrator')}
                >
                  Promote to orchestrator
                </button>
              ) : (
                <button
                  type="button"
                  className="rb-ow-ctx__item"
                  onClick={() => void setFleetRole(ctxMenu.agentId, 'agent')}
                >
                  Convert to worker agent
                </button>
              )}
              <div className="rb-ow-ctx__sep" aria-hidden />
              <button
                type="button"
                className="rb-ow-ctx__item"
                onClick={() => {
                  onAgentDetails(ctxMenu.agentId);
                  setCtxMenu(null);
                }}
              >
                Details...
              </button>
              <button
                type="button"
                className="rb-ow-ctx__item"
                onClick={() => {
                  onAgentTaskInstructions(ctxMenu.agentId);
                  setCtxMenu(null);
                }}
              >
                Task &amp; instructions...
              </button>
              <button
                type="button"
                className="rb-ow-ctx__item"
                onClick={() => {
                  const id = ctxMenu.agentId;
                  setCtxMenu(null);
                  onEditAgent(id);
                }}
              >
                Edit agent...
              </button>
              {agents.find(x => x.id === ctxMenu.agentId)?.runtimeMode !== 'offline' && (
                <button
                  type="button"
                  className="rb-ow-ctx__item"
                  onClick={() => {
                    onAgentSkills(ctxMenu.agentId);
                    setCtxMenu(null);
                  }}
                >
                  Assign skills...
                </button>
              )}
              <div className="rb-ow-ctx__sep" aria-hidden />
              {agents.find(x => x.id === ctxMenu.agentId)?.agentRole === 'orchestrator' ? (
                <>
                  <button type="button" className="rb-ow-ctx__item" onClick={() => setChainPick(true)}>
                    Attach worker...
                  </button>
                  <button
                    type="button"
                    className="rb-ow-ctx__item"
                    onClick={() => void clearChainsFor(ctxMenu.agentId)}
                  >
                    Remove all outgoing chains
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="rb-ow-ctx__item" onClick={() => setChainPick(true)}>
                    Report to orchestrator...
                  </button>
                  {agents.find(x => x.id === ctxMenu.agentId)?.linkedOrchestratorId && (
                    <button
                      type="button"
                      className="rb-ow-ctx__item"
                      onClick={() => void assignWorkerToOrchestrator(ctxMenu.agentId, null)}
                    >
                      Detach from orchestrator
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="rb-ow-ctx__sub">
              {agents.find(x => x.id === ctxMenu.agentId)?.agentRole === 'orchestrator' ? (
                <>
                  <div className="rb-ow-ctx__label">Attach worker to "{agents.find(x => x.id === ctxMenu.agentId)?.displayName}":</div>
                  {agents
                    .filter(x => x.id !== ctxMenu.agentId && x.agentRole !== 'orchestrator')
                    .map(t => (
                      <button
                        key={t.id}
                        type="button"
                        className="rb-ow-ctx__item"
                        onClick={() => void addChain(ctxMenu.agentId, t.id)}
                      >
                        {t.displayName}
                      </button>
                    ))}
                </>
              ) : (
                <>
                  <div className="rb-ow-ctx__label">Choose orchestrator for "{agents.find(x => x.id === ctxMenu.agentId)?.displayName}":</div>
                  {agents
                    .filter(x => x.id !== ctxMenu.agentId && x.agentRole === 'orchestrator')
                    .map(t => (
                      <button
                        key={t.id}
                        type="button"
                        className="rb-ow-ctx__item"
                        onClick={() => void assignWorkerToOrchestrator(ctxMenu.agentId, t.id)}
                      >
                        {t.displayName}
                      </button>
                    ))}
                </>
              )}
              <button type="button" className="rb-ow-ctx__back" onClick={() => setChainPick(false)}>
                Back
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
