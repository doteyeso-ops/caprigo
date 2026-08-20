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
  const llmStatLabel = llmStatus === 'live' ? 'Connected' : llmStatus === 'check' ? 'Needs check' : 'Unset';
  const llmStatClass = llmStatus === 'live' ? 'ok' : llmStatus === 'check' ? 'bad' : 'muted';
  const missionLabel = setupReady ? 'Ready to launch' : 'Finish setup';
  const missionCopy = setupReady
    ? 'The runtime is live. Start one focused worker, then move the task into Session or Board.'
    : 'Confirm runtime and model first, then create the first worker.';

  return (
    <section className="rb-dash-hero" aria-label="Overview">
      <div className="rb-dash-hero__main">
        <div className="rb-dash-hero__copy">
          <div className="rb-dash-hero__eyebrow-row">
            <p className="rb-dash-hero__eyebrow">Mission Control</p>
            <span className={`rb-dash-hero__state rb-dash-hero__state--${setupReady ? 'ready' : 'setup'}`}>
              {missionLabel}
            </span>
          </div>
          <h1 className="rb-dash-hero__title">Task-first command surface for your agent crew</h1>
          <p className="rb-dash-hero__tagline">{missionCopy}</p>

          <div className="rb-dash-hero__band" role="group" aria-label="Dashboard summary">
            <div className="rb-dash-hero__band-item">
              <span className="rb-dash-hero__band-label">Agents</span>
              <strong>{agentCount}</strong>
              <span className="rb-muted">Crew members online</span>
            </div>
            <div className="rb-dash-hero__band-item">
              <span className="rb-dash-hero__band-label">Tools</span>
              <strong>{skillCount}</strong>
              <span className="rb-muted">Skills and imports</span>
            </div>
            <div className="rb-dash-hero__band-item">
              <span className="rb-dash-hero__band-label">LLM</span>
              <strong className={`rb-dash-hero__band-value rb-dash-hero__band-value--${llmStatClass}`}>{llmStatLabel}</strong>
              <span className="rb-muted">{llmLabel}</span>
            </div>
          </div>

          {workspaceHint && (
            <p className="rb-dash-hero__ws" title={workspaceHint}>
              <span className="rb-dash-hero__ws-label">Workspace</span>
              <span className="rb-mono rb-dash-hero__ws-path">{workspaceHint}</span>
            </p>
          )}
        </div>

        <div className="rb-dash-hero__side">
          <div className="rb-dash-hero__signal">
            <span className="rb-dash-hero__signal-label">Next move</span>
            <strong>{setupReady ? 'Launch the first worker' : 'Complete runtime setup'}</strong>
            <p>{setupReady ? 'Create one focused agent and route its first task into Session or Board.' : 'Verify the provider, then choose a model and come back here.'}</p>
          </div>
          <div className="rb-dash-hero__actions">
            <button type="button" className="rb-btn rb-btn--accent rb-btn--hero" onClick={onCreateAgent}>
              Create agent
            </button>
            <p className="rb-dash-hero__cta-note rb-muted">Outcome-first defaults. Start small, then scale the crew.</p>
          </div>
          <div className="rb-dash-hero__chips" aria-label="Connection summary">
            <span className="rb-dash-hero__pill rb-mono">{llmLabel}</span>
            <span className="rb-dash-hero__pill rb-mono">Model <span className="rb-dash-hero__model">{modelLabel || '-'}</span></span>
          </div>
        </div>
      </div>
      <div className="rb-dash-hero__readyline" aria-hidden="true" />
    </section>
  );
}
