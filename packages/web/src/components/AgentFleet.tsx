import React, { useMemo } from 'react';
import { AgentCard } from './AgentCard';
import { OrchestrationFeedStrip } from './OrchestrationFeedStrip';
import type { AgentCardModel, LocalScriptItem } from '../types';

interface Props {
  agents: AgentCardModel[];
  selectedId: string | null;
  localScripts: LocalScriptItem[];
  onSelect: (id: string) => void;
  onOpenBoard: (id: string) => void;
  onOpenSession: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string) => void;
  onOpenBuilder: () => void;
  onEditAgent: (id: string) => void;
  onAgentDetails: (id: string) => void;
  onAgentSkills: (id: string) => void;
}

export function AgentFleet({
  agents,
  selectedId,
  localScripts,
  onSelect,
  onOpenBoard,
  onOpenSession,
  onClose,
  onRename,
  onOpenBuilder,
  onEditAgent,
  onAgentDetails,
  onAgentSkills,
}: Props) {
  const localNameById = useMemo(
    () => Object.fromEntries(localScripts.map(s => [s.id, s.name])),
    [localScripts]
  );

  const summary = useMemo(() => {
    let thinking = 0;
    let offline = 0;
    let orchestrators = 0;
    for (const agent of agents) {
      if (agent.status === 'thinking') thinking += 1;
      if (agent.runtimeMode === 'offline') offline += 1;
      if (agent.agentRole === 'orchestrator') orchestrators += 1;
    }
    return {
      thinking,
      offline,
      orchestrators,
      llm: Math.max(0, agents.length - offline),
    };
  }, [agents]);

  return (
    <section className="rb-fleet" aria-labelledby="fleet-heading">
      <div className="rb-fleet__intro">
        <h2 id="fleet-heading" className="rb-fleet__title">
          Crew roster
        </h2>
        <p className="rb-fleet__subtitle">
          Persistent workers for chat, tools, local scripts, and orchestration. Build around concrete outcomes, not
          generic conversations.{' '}
          <button type="button" className="rb-inline-link" onClick={onOpenBuilder}>
            New agent
          </button>
        </p>
        {agents.length > 0 && (
          <div className="rb-fleet__stats" aria-label="Fleet summary">
            <span className="rb-fleet__stat">{agents.length} total</span>
            <span className="rb-fleet__stat">{summary.llm} live</span>
            <span className="rb-fleet__stat">{summary.offline} local</span>
            <span className="rb-fleet__stat">
              {summary.orchestrators} orchestrator{summary.orchestrators === 1 ? '' : 's'}
            </span>
            <span className="rb-fleet__stat">{summary.thinking} working</span>
          </div>
        )}
      </div>

      <OrchestrationFeedStrip pollMs={9000} />

      {agents.length === 0 ? (
        <div className="rb-empty-fleet">
          <p>No agents yet.</p>
          <p className="rb-muted">
            Start with one focused worker. Recommended path: create a <strong>Coder</strong> or <strong>Research</strong>{' '}
            template, give it a clear outcome, then run the first task from <strong>Session</strong> or{' '}
            <strong>Board</strong>.
          </p>
        </div>
      ) : (
        <div className="rb-agent-grid">
          {agents.map(a => (
            <AgentCard
              key={a.id}
              agent={a}
              localNameById={localNameById}
              selected={selectedId === a.id}
              onSelect={() => onSelect(a.id)}
              onOpenBoard={() => onOpenBoard(a.id)}
              onOpenSession={() => onOpenSession(a.id)}
              onRename={() => onRename(a.id)}
              onEdit={() => onEditAgent(a.id)}
              onClose={() => onClose(a.id)}
              onDetails={() => onAgentDetails(a.id)}
              onAssignSkills={() => onAgentSkills(a.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
