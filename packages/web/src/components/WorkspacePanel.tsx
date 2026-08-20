import React, { useRef, useEffect, useState, useMemo } from 'react';
import type { AgentCardModel, ExecutionTraceEntry } from '../types';
import { inferWorkflowContext } from './workflows';
import { estimateTracePressure } from './traceHeuristics';

interface ThreadMessage {
  role: 'user' | 'assistant' | 'offline' | 'orchestration';
  content: string;
  offline?: {
    scriptId: string;
    scriptName?: string;
    exitCode: number;
    ok: boolean;
    stderr?: string;
  };
  orchestration?: {
    peerSessionId: string;
    peerLabel?: string;
    kind: 'directive' | 'update' | 'reply';
    channel: 'out' | 'in';
  };
}

interface Props {
  agents: AgentCardModel[];
  selected: AgentCardModel | null;
  traceEntries: ExecutionTraceEntry[];
  onSelectAgent: (id: string) => void;
  onOpenBoard?: (id: string) => void;
  onAgentDetails?: (id: string) => void;
  messages: ThreadMessage[];
  loading: boolean;
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
  /** Increment (e.g. from Board "Chat") to focus the message field after navigation. */
  focusInputSerial?: number;
}

export function WorkspacePanel({
  agents,
  selected,
  traceEntries,
  onSelectAgent,
  onOpenBoard,
  onAgentDetails,
  messages,
  loading,
  input,
  onInputChange,
  onSend,
  focusInputSerial = 0,
}: Props) {
  const offlineOnly = selected?.runtimeMode === 'offline';
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [thinkElapsedSec, setThinkElapsedSec] = useState(0);
  const workflowContext = useMemo(() => inferWorkflowContext(selected, agents), [selected, agents]);
  const tracePressure = useMemo(() => estimateTracePressure(traceEntries), [traceEntries]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (!loading) {
      setThinkElapsedSec(0);
      return;
    }
    const t0 = Date.now();
    const id = window.setInterval(() => {
      setThinkElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (!focusInputSerial || offlineOnly || !selected) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [focusInputSerial, offlineOnly, selected]);

  return (
    <section className="rb-workspace" aria-labelledby="chat-heading">
      <div className="rb-workspace__head">
        <h2 id="chat-heading" className="rb-workspace__title">
          Session
        </h2>
        {agents.length > 0 && (
          <label className="rb-workspace__agent-pick">
            <span className="rb-workspace__agent-pick-label">Agent</span>
            <select
              className="rb-input rb-workspace__agent-select"
              value={selected?.id ?? ''}
              onChange={e => {
                const v = e.target.value;
                if (v) onSelectAgent(v);
              }}
              aria-label="Agent for session"
            >
              {!selected && <option value="">Select agent...</option>}
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {selected && !offlineOnly ? (
          <p className="rb-workspace__sub">
            Active conversation with <strong>{selected.displayName}</strong> using LLM + tools
            <span className="rb-mono rb-workspace__model" title="Model for this session">
              {' '}
              · {selected.effectiveModel ?? '-'}
            </span>
            <span className="rb-mono rb-workspace__id">{selected.id.slice(0, 12)}...</span>
          </p>
        ) : selected && offlineOnly ? (
          <p className="rb-workspace__sub rb-workspace__sub--warn">
            <strong>{selected.displayName}</strong> is in <strong>offline / local</strong> mode, so there is no live
            Session chat. Use the <strong>Board</strong> to run disk scripts, or switch this agent back to{' '}
            <strong>LLM</strong> to work here.
            <span className="rb-mono rb-workspace__id">{selected.id.slice(0, 12)}...</span>
          </p>
        ) : (
          <p className="rb-workspace__sub rb-muted">Create an agent from Overview, then open its Session here.</p>
        )}
        {selected?.objective?.trim() && (
          <div className="rb-workspace__task-banner">
            <span className="rb-workspace__task-banner-label">Task</span>
            <strong className="rb-workspace__task-banner-title">
              {selected.taskState === 'done'
                ? 'Done'
                : selected.taskState === 'blocked'
                  ? 'Blocked'
                  : 'Persistent loop active'}
            </strong>
            <span className={`rb-workspace__task-state rb-workspace__task-state--${selected.taskState || 'continue'}`}>
              State: {selected.taskState || 'continue'}
            </span>
            <span className="rb-workspace__task-banner-copy">{selected.objective.trim()}</span>
            {selected.taskSummary?.trim() && (
              <span className="rb-workspace__task-banner-copy rb-workspace__task-banner-copy--muted">
                Checkpoint: {selected.taskSummary.trim()}
              </span>
            )}
            <span className="rb-muted">This session should keep iterating until it reports done or blocked.</span>
          </div>
        )}
        {workflowContext && (
          <div className="rb-workspace__workflow">
            <span className="rb-workspace__workflow-label">{workflowContext.workflow.title}</span>
            <span className="rb-workspace__workflow-copy">
              {workflowContext.workflow.blurb}
              {' '}
              {workflowContext.selectedIsLead
                ? 'This session is the workflow lead.'
                : `This session is part of ${workflowContext.lead.displayName}.`}
            </span>
          </div>
        )}
        {tracePressure && (tracePressure.pressure === 'heavy' || tracePressure.costSignal === 'high') && (
          <div className="rb-workspace__warning">
            <strong>Heavy session warning.</strong> Recent tool activity suggests this agent is carrying high context or cost pressure. Consider narrowing the task, reducing file/tool scope, or starting a fresh workflow step.
          </div>
        )}
        {selected && (
          <div className="rb-workspace__actions">
            <button
              type="button"
              className="rb-icon-btn"
              onClick={() => onOpenBoard?.(selected.id)}
            >
              Open board
            </button>
            <button
              type="button"
              className="rb-icon-btn"
              onClick={() => onAgentDetails?.(selected.id)}
            >
              Agent details
            </button>
            {!offlineOnly && selected.linkedOrchestratorId && (
              <span className="rb-workspace__crew-note">
                Reporting to crew lead {selected.linkedOrchestratorId.slice(0, 8)}...
              </span>
            )}
            {!offlineOnly && selected.agentRole === 'orchestrator' && (
              <span className="rb-workspace__crew-note">Crew lead: coordinate workers from Board, then continue chat here.</span>
            )}
          </div>
        )}
      </div>

      <div className="rb-workspace__thread">
        {!selected && (
          <div className="rb-workspace__empty">
            <p>
              Create an agent from <strong>Overview</strong>. Script output launched from the <strong>Board</strong>{' '}
              appears here as <strong>Local</strong> lines in the transcript.
            </p>
          </div>
        )}
        {selected && messages.length === 0 && !loading && (
          <div className="rb-workspace__empty">
            <p>No messages yet.</p>
            <p className="rb-muted">
              {offlineOnly
                ? 'This agent is offline-only. Use the Board to run disk scripts, or switch it to LLM to work here.'
                : 'Send a task here to use the model and tools. You can also run disk scripts for the same agent from the Board.'}
            </p>
          </div>
        )}
        {messages.map((msg, i) => {
          if (msg.role === 'offline') {
            const ok = msg.offline?.ok ?? true;
            return (
              <div key={i} className={`rb-bubble rb-bubble--local${ok ? '' : ' rb-bubble--local-fail'}`}>
                <span className="rb-bubble__role">
                  Local
                  {msg.offline?.scriptName ? ` · ${msg.offline.scriptName}` : ''} · exit {msg.offline?.exitCode ?? '-'}
                </span>
                <pre className="rb-bubble__text">{msg.content}</pre>
              </div>
            );
          }
          if (msg.role === 'orchestration' && msg.orchestration) {
            const o = msg.orchestration;
            const peer = o.peerLabel || o.peerSessionId.slice(0, 8);
            const dir = o.channel === 'out' ? 'To' : 'From';
            return (
              <div key={i} className="rb-bubble rb-bubble--fleet">
                <span className="rb-bubble__role">
                  Fleet · {o.kind} · {dir} {peer}
                </span>
                <pre className="rb-bubble__text">{msg.content}</pre>
              </div>
            );
          }
          return (
            <div
              key={i}
              className={`rb-bubble${msg.role === 'user' ? ' rb-bubble--user' : ' rb-bubble--assistant'}`}
            >
              <span className="rb-bubble__role">{msg.role === 'user' ? 'You' : 'Agent'}</span>
              <pre className="rb-bubble__text">{msg.content}</pre>
            </div>
          );
        })}
        {loading && (
          <div className="rb-bubble rb-bubble--assistant">
            <span className="rb-bubble__role">Agent</span>
            <p className="rb-thinking" title="Each tool round calls the model again; slow CPU/GPU can take many minutes.">
              LLM running...
              {thinkElapsedSec > 0 ? (
                <span className="rb-muted">
                  {' '}
                  (
                  {thinkElapsedSec < 60
                    ? `${thinkElapsedSec}s`
                    : `${Math.floor(thinkElapsedSec / 60)}m ${thinkElapsedSec % 60}s`}
                  )
                </span>
              ) : null}
            </p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="rb-workspace__compose">
        <textarea
          ref={inputRef}
          className="rb-textarea"
          rows={3}
          placeholder={
            !selected
              ? 'Select an agent from Overview or Board first'
              : offlineOnly
                ? 'Offline-only agent - switch to LLM on the Board to use Session chat'
                : 'Give this agent its next task...'
          }
          value={input}
          disabled={!selected || loading || offlineOnly}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <button
          type="button"
          className="rb-btn rb-btn--accent rb-workspace__send"
          disabled={!selected || loading || offlineOnly || !input.trim()}
          onClick={onSend}
        >
          Send
        </button>
      </div>
    </section>
  );
}
