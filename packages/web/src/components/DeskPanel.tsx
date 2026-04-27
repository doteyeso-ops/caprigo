import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentCardModel, LocalScriptItem } from '../types';
import { LEGACY_OPEN_WORKSPACE_KEY } from '../legacyStorageKeys';
import { ModelPicker } from './ModelPicker';

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
  localScripts: LocalScriptItem[];
  scriptsDir: string | null;
  offlineRunningId: string | null;
  onRunOfflineScript: (sessionId: string, scriptId: string) => Promise<void>;
  onSetRuntimeMode: (id: string, mode: 'llm' | 'offline') => Promise<void>;
  onSelectAgent: (id: string) => void;
  onOpenBuilder: () => void;
  onEditAgent: (id: string) => void;
  onRefreshAgents: () => Promise<AgentCardModel[]>;
  onCloseAgent: (id: string) => void;
  onRenameAgent: (id: string) => void;
  onAgentDetails: (id: string) => void;
  /** Open details scrolled to Task & instructions. */
  onAgentTaskInstructions: (id: string) => void;
  onAgentSkills: (id: string) => void;
  /** Select agent and jump to Session (LLM) or stay on Board (offline). */
  onPlayAgent: (id: string, runtimeMode: 'llm' | 'offline') => void;
  /** Best-effort stop for in-flight LLM turn. */
  onStopAgent: (id: string) => void;
  /** Chain orchestrator -> task agent: sets the worker's linked orchestrator. */
  onLinkWorkerToOrchestrator: (workerSessionId: string, orchestratorSessionId: string | null) => Promise<void>;
  engineModel: string;
  llmProvider?: string;
  ollamaModels: string[];
  onRefreshOllamaModels: () => void;
  onSetSessionModel: (sessionId: string, model: string | null) => Promise<void>;
}

export function DeskPanel({
  agents,
  selectedId,
  localScripts,
  scriptsDir,
  offlineRunningId,
  onRunOfflineScript,
  onSetRuntimeMode,
  onSelectAgent,
  onOpenBuilder,
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

  const localNameById = useMemo(() => Object.fromEntries(localScripts.map(s => [s.id, s.name])), [localScripts]);

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
        <button type="button" className="rb-btn rb-btn--accent" onClick={onOpenBuilder}>
          Add agent
        </button>
      </header>

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
            return (
              <article
                key={a.id}
                className={`rb-ow-node${selected ? ' rb-ow-node--selected' : ''}${drag?.id === a.id ? ' rb-ow-node--drag' : ''}`}
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
              <button type="button" className="rb-ow-ctx__item" onClick={() => setChainPick(true)}>
                Chain to...
              </button>
              <button
                type="button"
                className="rb-ow-ctx__item"
                onClick={() => void clearChainsFor(ctxMenu.agentId)}
              >
                Remove all chains for this agent
              </button>
            </>
          ) : (
            <div className="rb-ow-ctx__sub">
              <div className="rb-ow-ctx__label">Chain "{agents.find(x => x.id === ctxMenu.agentId)?.displayName}" to:</div>
              {agents
                .filter(x => x.id !== ctxMenu.agentId)
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
