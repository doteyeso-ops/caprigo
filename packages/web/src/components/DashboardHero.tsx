import React from 'react';

type LlmStatus = 'live' | 'check' | 'unset';

interface Props {
  agentCount: number;
  skillCount: number;
  llmStatus: LlmStatus;
  llmLabel: string;
  modelLabel: string;
  workspaceHint?: string | null;
  setupReady?: boolean;
  onCreateAgent: () => void;
}

export function DashboardHero({
  agentCount,
  skillCount,
  llmStatus,
  llmLabel,
  modelLabel,
  workspaceHint,
  setupReady,
  onCreateAgent,
}: Props) {
  const llmStatLabel = llmStatus === 'live' ? 'Live' : llmStatus === 'check' ? 'Check' : '-';
  const llmStatClass =
    llmStatus === 'live' ? 'ok' : llmStatus === 'check' ? 'bad' : 'muted';

  return (
    <section className="rb-dash-hero" aria-label="Overview">
      <div className="rb-dash-hero__main">
        <div className="rb-dash-hero__copy">
          <p className="rb-dash-hero__eyebrow">Overview</p>
          <h1 className="rb-dash-hero__title">Launch and manage your agent crew</h1>
          <p className="rb-dash-hero__tagline">
            Setup starts here. Confirm runtime health, verify the model, create focused agents, and then move to the
            Board or an individual Session for live operation.
          </p>
          {workspaceHint && (
            <p className="rb-dash-hero__ws" title={workspaceHint}>
              <span className="rb-dash-hero__ws-label">Workspace</span>
              <span className="rb-mono rb-dash-hero__ws-path">{workspaceHint}</span>
            </p>
          )}
          {setupReady && (
            <div className="rb-dash-hero__ready">
              <div className="rb-dash-hero__ready-head">
                <span className="rb-dash-hero__ready-badge">Setup complete</span>
                <strong>Caprigo is ready for the first agent.</strong>
              </div>
              <p className="rb-dash-hero__ready-copy">
                Backend health and model setup look good. The next step is to create one focused worker with a clear
                outcome, then move into Session or Board for live operation.
              </p>
            </div>
          )}
        </div>
        <div className="rb-dash-hero__stats" role="group" aria-label="Quick stats">
          <div className="rb-dash-stat">
            <span className="rb-dash-stat__value">{agentCount}</span>
            <span className="rb-dash-stat__label">Agents</span>
          </div>
          <div className="rb-dash-stat">
            <span className="rb-dash-stat__value">{skillCount}</span>
            <span className="rb-dash-stat__label">Tools</span>
          </div>
          <div className="rb-dash-stat rb-dash-stat--status">
            <span className={`rb-dash-stat__value rb-dash-stat__value--${llmStatClass}`}>{llmStatLabel}</span>
            <span className="rb-dash-stat__label">LLM</span>
          </div>
        </div>
        <div className="rb-dash-hero__cta">
          <button type="button" className="rb-btn rb-btn--accent rb-btn--hero" onClick={onCreateAgent}>
            Create agent
          </button>
          <p className="rb-dash-hero__cta-note rb-muted">User setup first, then agent operation with role templates and outcome-first defaults</p>
        </div>
      </div>
      <div className="rb-dash-hero__rail" aria-hidden="true">
        <span className="rb-dash-hero__pill rb-mono">{llmLabel}</span>
        <span className="rb-dash-hero__pill rb-mono">
          Model <span className="rb-dash-hero__model">{modelLabel || '-'}</span>
        </span>
      </div>
    </section>
  );
}
