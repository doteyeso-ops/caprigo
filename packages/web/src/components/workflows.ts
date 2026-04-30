export type WorkflowTemplateId = 'repo-coding' | 'offline-automation' | 'launch-audit' | 'pr-review';

export const WORKFLOW_LIBRARY: Array<{
  id: WorkflowTemplateId;
  title: string;
  roles: string;
  blurb: string;
  bestFor: string;
  leadName: string;
  memberNames: string[];
}> = [
  {
    id: 'repo-coding',
    title: 'Repo Crew',
    roles: 'Lead + Repo Scout + Code Operator',
    blurb: 'For code changes that benefit from scoped file discovery before implementation.',
    bestFor: 'Bug fixes, feature work, refactors, and repo-grounded implementation.',
    leadName: 'Repo Crew Lead',
    memberNames: ['Repo Scout', 'Code Operator'],
  },
  {
    id: 'offline-automation',
    title: 'Automation Crew',
    roles: 'Lead + Local Script Runner + Ops Reporter',
    blurb: 'For local runs, scripts, and operator-facing summaries without turning everything into chat.',
    bestFor: 'System checks, repeatable scripts, offline maintenance, and machine-local workflows.',
    leadName: 'Automation Lead',
    memberNames: ['Local Script Runner', 'Ops Reporter'],
  },
  {
    id: 'launch-audit',
    title: 'Launch Audit Crew',
    roles: 'Lead + Surface Checker + Risk Reviewer',
    blurb: 'For release-readiness passes across setup, UX, trust, and launch risk.',
    bestFor: 'Beta checks, release candidates, onboarding polish, and launch triage.',
    leadName: 'Launch Audit Lead',
    memberNames: ['Surface Checker', 'Risk Reviewer'],
  },
  {
    id: 'pr-review',
    title: 'PR Review Crew',
    roles: 'Lead + Diff Scout + Risk Reviewer',
    blurb: 'For structured review of a local diff, branch, patch, or hosted PR context.',
    bestFor: 'Merge review, regression checks, risk ranking, and missing-test analysis.',
    leadName: 'PR Review Lead',
    memberNames: ['Diff Scout', 'Risk Reviewer'],
  },
];

export function inferWorkflowContext(
  agent: { id: string; displayName: string; linkedOrchestratorId?: string | null; agentRole?: 'agent' | 'orchestrator' } | null,
  allAgents: Array<{ id: string; displayName: string; linkedOrchestratorId?: string | null; agentRole?: 'agent' | 'orchestrator' }>
) {
  if (!agent) return null;
  const orchestratorId = agent.agentRole === 'orchestrator' ? agent.id : agent.linkedOrchestratorId ?? null;
  if (!orchestratorId) return null;
  const lead = allAgents.find(item => item.id === orchestratorId);
  if (!lead) return null;
  const workflow = WORKFLOW_LIBRARY.find(item => item.leadName === lead.displayName);
  if (!workflow) return null;
  const members = allAgents.filter(item => item.linkedOrchestratorId === orchestratorId);
  return {
    workflow,
    lead,
    members,
    selectedIsLead: lead.id === agent.id,
  };
}
