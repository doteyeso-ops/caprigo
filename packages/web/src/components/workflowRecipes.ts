import type { WorkflowTemplateId } from './workflows';

export type WorkflowRecipeTriggerKind = 'manual' | 'file-change' | 'daily-sweep';

export interface WorkflowRecipe {
  id: string;
  name: string;
  templateId: WorkflowTemplateId;
  triggerKind: WorkflowRecipeTriggerKind;
  triggerValue: string;
  leadInstructionsMarkdown: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'caprigo.workflowRecipes.v1';

function normalizeRecipe(raw: unknown): WorkflowRecipe | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Partial<WorkflowRecipe>;
  if (!rec.id || !rec.name || !rec.templateId) return null;
  return {
    id: String(rec.id),
    name: String(rec.name),
    templateId: rec.templateId as WorkflowTemplateId,
    triggerKind: (rec.triggerKind as WorkflowRecipeTriggerKind) || 'manual',
    triggerValue: typeof rec.triggerValue === 'string' ? rec.triggerValue : '',
    leadInstructionsMarkdown: typeof rec.leadInstructionsMarkdown === 'string' ? rec.leadInstructionsMarkdown : '',
    createdAt: typeof rec.createdAt === 'number' ? rec.createdAt : Date.now(),
    updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now(),
  };
}

export function loadWorkflowRecipes(): WorkflowRecipe[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => normalizeRecipe(item))
      .filter((item): item is WorkflowRecipe => !!item)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveWorkflowRecipes(recipes: WorkflowRecipe[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
}

export function makeRecipeId() {
  return `recipe-${Math.random().toString(36).slice(2, 10)}`;
}
