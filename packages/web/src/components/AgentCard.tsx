import React, { useEffect, useState } from 'react';
import type { AgentCardModel } from '../types';

function ToolDot({ done, permissionWait }: { done: boolean; permissionWait?: boolean }) {
  const cls =
    done ? ' rb-dot--done' : permissionWait ? ' rb-dot--permission' : ' rb-dot--active';
  return <span className={`rb-dot${cls}`} />;
}

function ToolLine({ task }: { task: AgentCardModel['tasks'][0] }) {
  const label =
    task.permissionWait && !task.done ? 'Needs approval' : task.status;
  return (
    <div className={`rb-tool-line${task.done ? ' rb-tool-line--done' : ''}`}>
      <ToolDot done={task.done} permissionWait={task.permissionWait} />
      <span>{label}</span>
    </div>
  );
}

function summarizeAgentState(agent: AgentCardModel, localNameById: Record<string, string>): string {
  if (agent.status === 'error') {
    return 'Blocked by an error. Open details or the Session view to inspect the failure.';
  }
  if (agent.status === 'thinking') {
    if (agent.tasks.length > 0) {
      return `Working through ${agent.tasks.length} active step${agent.tasks.length === 1 ? '' : 's'}.`;
    }
    return 'Working on the current request.';
  }
  if (agent.runtimeMode === 'offline') {
    if (agent.primaryOfflineScriptId) {
      return `Ready to run ${localNameById[agent.primaryOfflineScriptId] || 'its assigned script'} from the Board.`;
    }
    return 'Offline-only agent waiting for a script assignment.';
  }
  if (agent.agentRole === 'orchestrator') {
    return 'Ready to coordinate linked worker agents.';
  }
  if (agent.linkedOrchestratorId) {
    return `Ready for work and linked to orchestrator ${agent.linkedOrchestratorId.slice(0, 6)}….`;
  }
  return 'Ready for a new chat task or local workflow.';
}

interface Props {
  agent: AgentCardModel;
  localNameById: Record<string, string>;
  selected: boolean;
  onSelect: () => void;
  onRename: () => void;
  onEdit: () => void;
  onClose: () => void;
  onDetails: () => void;
  onAssignSkills: () => void;
}

export function AgentCard({
  agent: a,
  localNameById,
  selected,
  onSelect,
  onRename,
  onEdit,
  onClose,
  onDetails,
  onAssignSkills,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const showWaiting = a.status === 'thinking' && a.tasks.every(t => t.done);
  const hasActivity = a.tasks.length > 0 || showWaiting || a.status === 'error';
  const assigned = a.assignedOfflineScripts ?? [];
  const idleHint =
    a.status === 'idle' && a.tasks.length === 0 && assigned.length === 0;
  const mode = a.runtimeMode === 'offline' ? 'offline' : 'llm';
  const isOrchestrator = a.agentRole === 'orchestrator';
  const skillN = a.assignedSkills?.length ?? 0;
  const skillLabel = skillN === 0 ? 'All skills' : `${skillN} skill${skillN === 1 ? '' : 's'}`;
  const objectiveText = a.objective?.trim();
  const stateSummary = summarizeAgentState(a, localNameById);

  useEffect(() => {
    if (!menu) return;
    const close = (ev: MouseEvent) => {
      const el = ev.target as HTMLElement;
      if (el.closest('.rb-ow-ctx')) return;
      setMenu(null);
    };
    const id = window.setTimeout(() => document.addEventListener('mousedown', close), 10);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', close);
    };
  }, [menu]);

  return (
    <article
      className={`rb-agent-card${selected ? ' rb-agent-card--selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => e.key === 'Enter' && onSelect()}
      onContextMenu={e => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="rb-agent-card__top">
        <div className="rb-agent-card__title-row">
          <h3 className="rb-agent-card__name">{a.displayName}</h3>
          <div className="rb-agent-card__actions">
            <button type="button" className="rb-icon-btn" title="Edit in builder" onClick={e => { e.stopPropagation(); onEdit(); }}>
              Edit
            </button>
            <button type="button" className="rb-icon-btn" title="Rename" onClick={e => { e.stopPropagation(); onRename(); }}>
              Rename
            </button>
            <button type="button" className="rb-icon-btn rb-icon-btn--danger" title="Remove agent" onClick={e => { e.stopPropagation(); onClose(); }}>
              Remove
            </button>
          </div>
        </div>
        {a.description?.trim() ? (
          <p className="rb-agent-card__desc">{a.description.trim().slice(0, 140)}{a.description.length > 140 ? '…' : ''}</p>
        ) : null}
        <div className="rb-agent-card__focus">
          <span className="rb-agent-card__focus-label">Focus</span>
          <p className="rb-agent-card__focus-text">
            {objectiveText
              ? `${objectiveText.slice(0, 170)}${objectiveText.length > 170 ? '…' : ''}`
              : 'No essential outcome set yet. Define one in Edit agent to improve autonomy and handoffs.'}
          </p>
        </div>
        <div className="rb-agent-card__meta">
          <span className={`rb-status-pill rb-status-pill--${a.status}`}>{a.status}</span>
          <span
            className={`rb-runtime-pill rb-runtime-pill--${mode}`}
            title={mode === 'llm' ? 'Uses server LLM in Session view' : 'Offline-only - use the Board for disk scripts'}
          >
            {mode === 'llm' ? 'LLM' : 'Offline'}
          </span>
          {isOrchestrator && (
            <span className="rb-fleet-pill" title="May coordinate other agents via fleet tools">
              Orchestrator
            </span>
          )}
          {!isOrchestrator && a.linkedOrchestratorId && (
            <span
              className="rb-fleet-pill rb-fleet-pill--link"
              title={`Linked orchestrator: ${a.linkedOrchestratorId}`}
            >
              Agent → {a.linkedOrchestratorId.slice(0, 6)}…
            </span>
          )}
          <span className="rb-agent-card__meta-muted">{a.messageCount} messages</span>
          <span
            className="rb-agent-card__meta-muted"
            title={mode === 'llm' ? 'LLM tools for this session' : 'No chat LLM for this agent'}
          >
            {mode === 'llm' ? skillLabel : '—'}
          </span>
          {mode === 'llm' && (
            <span className="rb-agent-card__meta-muted rb-mono" title="Model used for chat">
              {a.effectiveModel ?? '—'}
            </span>
          )}
          <span className="rb-agent-card__meta-muted rb-mono">{a.id.slice(0, 8)}…</span>
        </div>
        {mode === 'offline' && a.primaryOfflineScriptId && (
          <p className="rb-agent-card__primary-off">
            <span className="rb-muted">Script:</span>{' '}
            <strong>{localNameById[a.primaryOfflineScriptId] || a.primaryOfflineScriptId}</strong>
          </p>
        )}
        {assigned.length > 0 && (
          <div className="rb-agent-card__local-strip" aria-label="Local scripts assigned">
            <span className="rb-agent-card__local-lbl">Local</span>
            {assigned.map(id => (
              <span key={id} className="rb-local-tag">
                {localNameById[id] || id}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rb-agent-card__activity">
        <div className="rb-agent-card__activity-label">Activity</div>
        <div className="rb-agent-card__activity-body">
          <p className="rb-agent-card__summary">{stateSummary}</p>
          {idleHint && (
            <p className="rb-agent-card__idle">
              {mode === 'llm' ? (
                <>
                  Idle — use <strong>Session</strong> for the model or <strong>Board</strong> to run disk scripts.
                </>
              ) : (
                <>
                  Idle — <strong>Board</strong>: pick a script and Run (no LLM). Switch card to <strong>LLM</strong> to use Session chat.
                </>
              )}
            </p>
          )}
          {hasActivity && (
            <>
              {a.tasks.map(t => (
                <ToolLine key={t.taskId} task={t} />
              ))}
              {showWaiting && (
                <div className="rb-tool-line">
                  <ToolDot done={false} />
                  <span>Waiting…</span>
                </div>
              )}
              {a.status === 'error' && a.lastError && (
                <p className="rb-agent-card__err">{a.lastError.slice(0, 400)}{a.lastError.length > 400 ? '…' : ''}</p>
              )}
            </>
          )}
        </div>
      </div>

      {menu && (
        <div
          className="rb-ow-ctx"
          style={{ left: menu.x, top: menu.y }}
          onClick={e => e.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            className="rb-ow-ctx__item"
            onClick={() => {
              setMenu(null);
              onDetails();
            }}
          >
            Details…
          </button>
          <button
            type="button"
            className="rb-ow-ctx__item"
            onClick={() => {
              setMenu(null);
              onEdit();
            }}
          >
            Edit agent…
          </button>
          {mode === 'llm' && (
            <button
              type="button"
              className="rb-ow-ctx__item"
              onClick={() => {
                setMenu(null);
                onAssignSkills();
              }}
            >
              Assign skills…
            </button>
          )}
        </div>
      )}
    </article>
  );
}
